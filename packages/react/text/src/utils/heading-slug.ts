import GithubSlugger from 'github-slugger';

/** One slugger per document, visited in heading order (including duplicates). */
export const createDocumentHeadingSlugger = () => {
  const slugger = new GithubSlugger();
  return (text: string): string => slugger.slug(text);
};
