import { z } from "zod";

export const InstitutionType = z
  .enum([
    "commercial_bank",
    "microfinance_bank",
    "microfinance_institution",
    "sacco",
    "payment_service_provider",
    "forex_bureau",
    "insurance_company",
    "pension_fund",
  ])
  .meta({
    id: "InstitutionType",
    description: "Category of regulated financial institution.",
  });

export type InstitutionType = z.infer<typeof InstitutionType>;
