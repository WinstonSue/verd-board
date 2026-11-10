import catalogData from '../recommendations.json';

/** User-facing suggestions and examples, never an Agent instruction source. */
export interface AuthoringRecommendation {
  id: string;
  version: number;
  title: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  templatePaths: string[];
  rootFileId: string;
  guidePath: string;
}

export const recommendations: readonly AuthoringRecommendation[] = catalogData;
export const recommendationWorkspaceUrl = new URL(
  '../workspace/',
  import.meta.url,
);
const templates = import.meta.glob('../workspace/**/*.verd*.json', {
  import: 'default',
});

export async function loadRecommendationTemplates(
  id: string,
): Promise<unknown[]> {
  const recommendation = recommendations.find((item) => item.id === id);
  if (!recommendation) throw new Error('Unknown recommendation: ' + id);
  return Promise.all(
    recommendation.templatePaths.map(async (path) => {
      const load = templates['../workspace/' + path];
      if (!load) throw new Error('Missing recommendation template: ' + path);
      return load();
    }),
  );
}
