import fs from 'node:fs';
import path from 'node:path';
export default class Reporter {
  rows=[];
  onTestEnd(test,result){
    this.rows.push({id:test.titlePath().join(' / '),status:result.status,duration_ms:result.duration,
      expected:test.expectedStatus,error:result.error?.message?.replace(/\u001b\[[0-9;]*m/g,'')||null,
      evidence:result.attachments.filter(a=>a.path).map(a=>({name:a.name,path:path.relative(process.cwd(),a.path)}))});
  }
  onEnd(result){
    fs.mkdirSync('report',{recursive:true});
    const coverage=JSON.parse(fs.readFileSync(new URL('./coverage.json',import.meta.url)));
    const counts={passed:0,failed:0,blocked:0};
    for(const r of this.rows)counts[r.status==='passed'?'passed':['skipped','interrupted'].includes(r.status)?'blocked':'failed']++;
    const report={generated_at:new Date().toISOString(),commit:process.env.GITHUB_SHA||null,status:result.status,
      environment:'Production frontend with synthetic services; no live backend validation',counts,coverage,tests:this.rows};
    fs.writeFileSync('report/qa-summary.json',JSON.stringify(report,null,2));
    const escape=s=>String(s).replace(/\|/g,'\\|').replace(/\n/g,' ');
    const lines=['# Ecco UX QA report','',`**${counts.passed} passed · ${counts.failed} failed · ${counts.blocked} blocked tests**`,'',
      'Production frontend with synthetic service data. Passing fixture tests do not prove live OAuth, storage, generation, payments or publishing.','',
      '| Workflow | Coverage | Scope |','|---|---|---|',...coverage.map(c=>`| ${c.area} | ${c.mode} | ${c.scope} |`),'',
      '| Result | Check | Failure |','|---|---|---|',...this.rows.map(r=>`| ${r.status} | ${escape(r.id)} | ${escape((r.error||'').slice(0,600))} |`)];
    fs.writeFileSync('report/QA-REPORT.md',lines.join('\n'));
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n'));
  }
}
