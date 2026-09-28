/**
 * Starter rubrics. `weight` is the percentage used in weighted mode;
 * `maxScore` is the per-criterion maximum used in points mode. Both are stored
 * so an organizer can flip scoring_mode without re-entering the rubric.
 */
export const RUBRIC_TEMPLATES = {
  general: {
    id: 'general',
    labelKey: 'template.general',
    criteria: [
      { key: 'technical', maxScore: 10, weight: 25 },
      { key: 'innovation', maxScore: 10, weight: 20 },
      { key: 'impact', maxScore: 10, weight: 20 },
      { key: 'design', maxScore: 10, weight: 15 },
      { key: 'completeness', maxScore: 10, weight: 10 },
      { key: 'presentation', maxScore: 10, weight: 10 },
    ],
  },
  prototyping: {
    id: 'prototyping',
    labelKey: 'template.prototyping',
    criteria: [
      { key: 'completeness', maxScore: 10, weight: 30 },
      { key: 'presentation', maxScore: 10, weight: 20 },
      { key: 'technical', maxScore: 10, weight: 20 },
      { key: 'design', maxScore: 10, weight: 15 },
      { key: 'impact', maxScore: 10, weight: 15 },
    ],
  },
  research: {
    id: 'research',
    labelKey: 'template.research',
    criteria: [
      { key: 'innovation', maxScore: 10, weight: 30 },
      { key: 'technical', maxScore: 10, weight: 30 },
      { key: 'impact', maxScore: 10, weight: 20 },
      { key: 'presentation', maxScore: 10, weight: 10 },
      { key: 'completeness', maxScore: 10, weight: 10 },
    ],
  },
  blank: { id: 'blank', labelKey: 'template.blank', criteria: [] },
};

/**
 * English fallbacks written into the database when a template is applied.
 * Criterion names are organizer-authored content, so they are stored as text
 * rather than translation keys - the organizer can rename them per event.
 */
export const CRITERION_TEXT = {
  technical: {
    name: 'Technical execution',
    description: 'Code quality, technical difficulty, how much actually works versus how much is faked in the demo.',
  },
  innovation: {
    name: 'Innovation / originality',
    description: 'Novelty of the idea, creative use of the theme, APIs or sponsor tools.',
  },
  impact: {
    name: 'Impact / usefulness',
    description: 'Real-world value if shipped, size of the problem solved, strength of the problem fit.',
  },
  design: {
    name: 'Design / UX',
    description: 'Clarity and polish of the interface, how intuitive it is, visual and interaction quality.',
  },
  completeness: {
    name: 'Completeness',
    description: 'How finished the project is: a working end-to-end flow versus a screenshot and a promise.',
  },
  presentation: {
    name: 'Presentation / demo',
    description: 'Clarity of the pitch, how well the team communicated the idea in their allotted time.',
  },
};

export function templateCriteria(templateId) {
  const template = RUBRIC_TEMPLATES[templateId];
  if (!template) return null;
  return template.criteria.map((c, index) => ({
    name: CRITERION_TEXT[c.key]?.name || c.key,
    description: CRITERION_TEXT[c.key]?.description || '',
    maxScore: c.maxScore,
    weight: c.weight,
    sortOrder: index,
  }));
}

export const templateList = () =>
  Object.values(RUBRIC_TEMPLATES).map((t) => ({
    id: t.id,
    labelKey: t.labelKey,
    criterionCount: t.criteria.length,
  }));
