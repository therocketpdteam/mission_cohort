import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"cohort-overview.spec.ts",workers:1,timeout:45000,reporter:"list",outputDir:"../../test-results/cohort-overview",use:{headless:true,channel:process.env.HISTORY_BROWSER_CHANNEL==="chrome"?"chrome":undefined,viewport:{width:1440,height:1000},screenshot:"only-on-failure"}});
