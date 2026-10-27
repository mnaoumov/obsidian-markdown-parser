import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { config } = await jiti.import('./scripts/git/nano-staged-config.ts');
export default config;
