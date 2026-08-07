import { pool } from '../db.js';

/**
 * Resolves the applicable rate card for a visit and computes the three-value billing split:
 * lounge_cost (what the lounge charges the agent, or the pax directly if individual),
 * agent_markup (the agent's margin — zero for individual/cash and for direct corporate accounts),
 * client_charge (what the corporate account or individual actually pays).
 *
 * Resolution order, most specific wins: corporate_account rate card > tenant rate card > global.
 * Only rate cards active at the visit's date/time are considered (effective_from/effective_to),
 * so past visits are never affected by a later rate change.
 */
export async function resolveBilling({ corporateAccountId, tenantId, visitDateTime }) {
  const at = visitDateTime || new Date();

  async function findRateCard(scopeType, scopeId) {
    const { rows } = await pool.query(
      `SELECT * FROM rate_cards
       WHERE scope_type = $1
         AND (scope_id = $2 OR ($2 IS NULL AND scope_id IS NULL))
         AND effective_from <= $3
         AND (effective_to IS NULL OR effective_to > $3)
       ORDER BY effective_from DESC
       LIMIT 1`,
      [scopeType, scopeId, at]
    );
    return rows[0] || null;
  }

  let rateCard = null;
  if (corporateAccountId) rateCard = await findRateCard('corporate_account', corporateAccountId);
  if (!rateCard && tenantId) rateCard = await findRateCard('tenant', tenantId);
  if (!rateCard) rateCard = await findRateCard('global', null);

  if (!rateCard) {
    throw new Error('No applicable rate card found — a lounge admin must configure at least a global rate card.');
  }

  const loungeCost = Number(rateCard.lounge_rate);
  let markup = 0;
  // Only agent-managed (tenant-linked) corporate accounts carry a markup layer.
  // Direct corporate accounts (no tenant) and individual/cash pax pay the lounge rate with no markup.
  if (corporateAccountId && tenantId) {
    markup = rateCard.markup_type === 'percentage'
      ? loungeCost * (Number(rateCard.markup_value) / 100)
      : Number(rateCard.markup_value);
  }
  const clientCharge = loungeCost + markup;

  return {
    lounge_cost: Number(loungeCost.toFixed(2)),
    agent_markup: Number(markup.toFixed(2)),
    client_charge: Number(clientCharge.toFixed(2)),
    rate_card_id: rateCard.id,
  };
}
