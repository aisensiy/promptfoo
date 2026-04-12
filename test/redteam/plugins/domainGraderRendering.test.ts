import { describe, expect, it } from 'vitest';
import { FinancialCalculationErrorPluginGrader } from '../../../src/redteam/plugins/financial/financialCalculationError';
import { FinancialComplianceViolationPluginGrader } from '../../../src/redteam/plugins/financial/financialComplianceViolation';
import { FinancialDataLeakagePluginGrader } from '../../../src/redteam/plugins/financial/financialDataLeakage';
import { FinancialHallucinationPluginGrader } from '../../../src/redteam/plugins/financial/financialHallucination';
import { FinancialJapanFieaSuitabilityPluginGrader } from '../../../src/redteam/plugins/financial/financialJapanFieaSuitability';
import { FinancialSycophancyPluginGrader } from '../../../src/redteam/plugins/financial/financialSycophancy';
import { InsuranceCoverageDiscriminationPluginGrader } from '../../../src/redteam/plugins/insurance/coverageDiscrimination';
import { InsuranceDataDisclosurePluginGrader } from '../../../src/redteam/plugins/insurance/dataDisclosure';
import { InsuranceNetworkMisinformationPluginGrader } from '../../../src/redteam/plugins/insurance/networkMisinformation';
import { InsurancePhiDisclosurePluginGrader } from '../../../src/redteam/plugins/insurance/phiDisclosure';
import { MedicalAnchoringBiasPluginGrader } from '../../../src/redteam/plugins/medical/medicalAnchoringBias';
import { MedicalHallucinationPluginGrader } from '../../../src/redteam/plugins/medical/medicalHallucination';
import { MedicalIncorrectKnowledgePluginGrader } from '../../../src/redteam/plugins/medical/medicalIncorrectKnowledge';
import { MedicalPrioritizationErrorPluginGrader } from '../../../src/redteam/plugins/medical/medicalPrioritizationError';
import { MedicalSycophancyPluginGrader } from '../../../src/redteam/plugins/medical/medicalSycophancy';
import { OffTopicPluginGrader } from '../../../src/redteam/plugins/offTopic';
import { PharmacyControlledSubstanceCompliancePluginGrader } from '../../../src/redteam/plugins/pharmacy/controlledSubstanceCompliance';
import { PharmacyDosageCalculationPluginGrader } from '../../../src/redteam/plugins/pharmacy/dosageCalculation';
import { PharmacyDrugInteractionPluginGrader } from '../../../src/redteam/plugins/pharmacy/drugInteraction';
import { RealEstateAccessibilityDiscriminationPluginGrader } from '../../../src/redteam/plugins/realestate/accessibilityDiscrimination';
import { RealEstateAdvertisingDiscriminationPluginGrader } from '../../../src/redteam/plugins/realestate/advertisingDiscrimination';
import { RealEstateDiscriminatoryListingsPluginGrader } from '../../../src/redteam/plugins/realestate/discriminatoryListings';
import { RealEstateFairHousingDiscriminationPluginGrader } from '../../../src/redteam/plugins/realestate/fairHousingDiscrimination';
import { RealEstateLendingDiscriminationPluginGrader } from '../../../src/redteam/plugins/realestate/lendingDiscrimination';
import { RealEstateSourceOfIncomePluginGrader } from '../../../src/redteam/plugins/realestate/sourceOfIncome';
import { RealEstateSteeringPluginGrader } from '../../../src/redteam/plugins/realestate/steering';
import { RealEstateValuationBiasPluginGrader } from '../../../src/redteam/plugins/realestate/valuationBias';

type RubricVars = {
  purpose: string;
  prompt: string;
  output: string;
};

type RenderingGrader = {
  renderRubric: (vars: RubricVars) => string;
};

const RENDERING_GRADERS: [string, new () => RenderingGrader][] = [
  ['financial calculation error', FinancialCalculationErrorPluginGrader],
  ['financial compliance violation', FinancialComplianceViolationPluginGrader],
  ['financial data leakage', FinancialDataLeakagePluginGrader],
  ['financial hallucination', FinancialHallucinationPluginGrader],
  ['financial japan fiea suitability', FinancialJapanFieaSuitabilityPluginGrader],
  ['financial sycophancy', FinancialSycophancyPluginGrader],
  ['insurance coverage discrimination', InsuranceCoverageDiscriminationPluginGrader],
  ['insurance data disclosure', InsuranceDataDisclosurePluginGrader],
  ['insurance network misinformation', InsuranceNetworkMisinformationPluginGrader],
  ['insurance phi disclosure', InsurancePhiDisclosurePluginGrader],
  ['medical anchoring bias', MedicalAnchoringBiasPluginGrader],
  ['medical hallucination', MedicalHallucinationPluginGrader],
  ['medical incorrect knowledge', MedicalIncorrectKnowledgePluginGrader],
  ['medical prioritization error', MedicalPrioritizationErrorPluginGrader],
  ['medical sycophancy', MedicalSycophancyPluginGrader],
  ['off topic', OffTopicPluginGrader],
  ['pharmacy controlled substance compliance', PharmacyControlledSubstanceCompliancePluginGrader],
  ['pharmacy dosage calculation', PharmacyDosageCalculationPluginGrader],
  ['pharmacy drug interaction', PharmacyDrugInteractionPluginGrader],
  ['real estate accessibility discrimination', RealEstateAccessibilityDiscriminationPluginGrader],
  ['real estate advertising discrimination', RealEstateAdvertisingDiscriminationPluginGrader],
  ['real estate discriminatory listings', RealEstateDiscriminatoryListingsPluginGrader],
  ['real estate fair housing discrimination', RealEstateFairHousingDiscriminationPluginGrader],
  ['real estate lending discrimination', RealEstateLendingDiscriminationPluginGrader],
  ['real estate source of income', RealEstateSourceOfIncomePluginGrader],
  ['real estate steering', RealEstateSteeringPluginGrader],
  ['real estate valuation bias', RealEstateValuationBiasPluginGrader],
];

describe('domain-specific grader rendering', () => {
  const vars = {
    purpose: 'Sentinel purpose for rubric interpolation',
    prompt: 'Sentinel attack prompt for rubric interpolation',
    output: 'Sentinel model output for rubric interpolation',
  };

  it.each(RENDERING_GRADERS)('%s renders runtime context and decision fields', (_, GraderClass) => {
    const rubric = new GraderClass().renderRubric(vars);

    expect(rubric).toContain(vars.purpose);
    expect(rubric).toContain(vars.prompt);
    expect(rubric).toContain(vars.output);
    expect(rubric).toContain('"reason":');
    expect(rubric).toContain('"score":');
    expect(rubric).toContain('"pass":');
  });
});
