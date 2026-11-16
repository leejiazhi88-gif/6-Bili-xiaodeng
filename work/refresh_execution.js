const quality = require('./refresh_validation');

// Independent of child processes so retry/invalidation behavior can be
// exercised with real files and failing tasks without touching live APIs.
async function executeVerifiedTasks({root,tasks,mode,context,summary,previous,runTasks,run,save,log=console.log,now=Date.now}) {
  const code = quality.codeFingerprint(root);
  const recovering = mode === 'daily' && previous?.mode === mode && ['failed','running'].includes(previous.status) &&
    previous.code === code && previous.context?.today === context.today && previous.context.expectedSession === context.expectedSession &&
    now()-Date.parse(previous.startedAt)>=0 && now()-Date.parse(previous.startedAt)<4*60*60*1000;
  summary.code=code;
  summary.baselines=Object.fromEntries(tasks.map(task=>[task.id,
    recovering && previous.baselines?.[task.id] || quality.snapshot(root,task)]));
  save();
  await runTasks(tasks,async task=>{
    const input=quality.inputFingerprint(root,task,tasks,code);
    const checkpoint=recovering && previous.checkpoints?.[task.id];
    const reused=checkpoint && quality.reusable(checkpoint,{mode,now:now(),...context,input,
      output:quality.fingerprint(root,quality.CONTRACTS[task.id].files)});
    if(!reused) await run(task);
    const checks=quality.validateTask(root,task,summary.baselines[task.id],context);
    const receipt={today:context.today,expectedSession:context.expectedSession,input,
      output:quality.fingerprint(root,quality.CONTRACTS[task.id].files),
      checkedAt:reused?checkpoint.checkedAt:new Date(now()).toISOString(),
      contentChanged:reused?checkpoint.contentChanged:Object.entries(quality.snapshot(root,task))
        .some(([name,value])=>value.contentHash!==summary.baselines[task.id][name]?.contentHash),
      execution:reused?'resumed_verified_output':'executed',checks};
    summary.checkpoints[task.id]=receipt;save();
    if(reused) log(`[refresh] ${task.id}: reused verified output from failed run`);
    return {execution:receipt.execution,checkedAt:receipt.checkedAt};
  },{records:summary.tasks,log});
}
module.exports={executeVerifiedTasks};
