import { createLibViteConfig } from '../../../scripts/lib-vite';
export default createLibViteConfig({
  dirname: __dirname,
  name: 'verd-board-agent-patterns',
  entry: 'src/index.ts',
  extraEntries: {
    agent: 'src/agent.ts',
    recommendations: 'src/recommendations.ts',
  },
  cacheDir: '../../../node_modules/.vite/agent-patterns',
  testEnvironment: 'node',
});
