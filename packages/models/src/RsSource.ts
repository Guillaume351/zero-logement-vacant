export const RS_SOURCE_VALUES = ['declaration', 'taxe-habitation'] as const;

export type RsSource = (typeof RS_SOURCE_VALUES)[number];

export const RS_SOURCE_LABELS: Record<RsSource, string> = {
  declaration: 'Déclaration d’occupation',
  'taxe-habitation': 'Taxe d’habitation'
};
