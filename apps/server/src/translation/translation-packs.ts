import { INDUSTRY_PACKS, IndustryPack } from './guard';

/** GET /translation/lexicons/packs — built-in PurpleLex starter packs. */
export function listIndustryPacks() {
  return INDUSTRY_PACKS.map((p) => ({
    industry: p.industry,
    name: p.name,
    description: p.description,
    termCount: p.terms.length,
  }));
}

export function findIndustryPack(industry: string): IndustryPack | null {
  const key = industry.trim().toLowerCase();
  return INDUSTRY_PACKS.find((p) => p.industry === key) ?? null;
}
