import {test,expect} from '@playwright/test';
async function open(page){
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Agents',exact:true}).click();
 await page.locator('.agent-card').click();await expect(page.getByRole('heading',{name:'Tester Agent',exact:true})).toBeVisible();
}
test('AGENT-01 50 findings and 25 critical issues create 25 separate tickets',async({page})=>{
 await open(page);
 const report={generated_at:'2026-11-07T12:00:00Z',commit:'synthetic-only',tests:Array.from({length:50},(_,i)=>({id:(i<25?'AUTH-':'LIB-')+i,status:'failed',error:'Fixture finding '+i,evidence:[]}))};
 await page.getByLabel('Import CI report',{exact:true}).setInputFiles({name:'qa-summary.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report))});
 await expect(page.locator('.agent-finding')).toHaveCount(50);
 await page.getByRole('button',{name:'Select critical (25)',exact:true}).click();
 await expect(page.locator('.agent-finding input:checked')).toHaveCount(25);
 await page.getByRole('button',{name:'Create 25 separate tickets',exact:true}).click();
 await expect(page.locator('.agent-ticket-link')).toHaveCount(25);
 expect(await page.evaluate(()=>window.__deskPosts.length)).toBe(25);
 await expect(page.locator('.agent-finding')).toHaveCount(50);
 await page.locator('.agent-finding summary').first().click();await expect(page.getByText('Fixture finding 0',{exact:true})).toBeVisible();
});
test('AGENT-02 run Video workflow, report observed search bug and decoded thumbnails',async({page})=>{
 test.setTimeout(90000);await open(page);
 await page.getByLabel('Action',{exact:true}).selectOption('workflow');await page.getByLabel('Workflow',{exact:true}).selectOption('video');
 await page.getByRole('button',{name:'Run checks',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Run checks',exact:true})).toBeEnabled({timeout:75000});
 const report=await page.evaluate(()=>JSON.parse(localStorage.getItem('ecco-tester-runs:v1:qa-desk-user')||'[]')[0]);
 expect(report.checks.some(c=>c.id==='video-small-thumb-0'&&c.status==='passed')).toBe(true);
 expect(report.checks.some(c=>c.id==='video-large-thumb-0'&&c.status==='passed')).toBe(true);
 expect(report.findings.some(c=>c.id==='video-search')).toBe(true);
 expect(report.checks.some(c=>c.id==='runner'||c.id==='load')).toBe(false);
 expect(await page.evaluate(()=>window.__deskPosts.length)).toBe(0);
});
