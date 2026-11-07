import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',timeout:25000,expect:{timeout:5000},fullyParallel:true,
  forbidOnly:!!process.env.CI,retries:0,workers:process.env.CI?2:2,
  reporter:[['list'],['html',{outputFolder:'report',open:'never'}],['./reporter.mjs']],
  outputDir:'results',
  use:{channel:'chrome',baseURL:'http://127.0.0.1:4173',viewport:{width:1440,height:1000},locale:'en-US',timezoneId:'America/Los_Angeles',
    screenshot:'on',trace:'retain-on-failure',video:'retain-on-failure',serviceWorkers:'block'},
  webServer:{command:'node server.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:20000}
});
