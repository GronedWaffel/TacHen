import test from 'node:test';
import assert from 'node:assert/strict';
import { startupNotification } from '../src/startup-notification.mjs';
test('startup instructions require both completed startup and a ready menu', () => {
  assert.match(startupNotification({completed:true},true,'192.168.1.2'),/Hold L3/);
  for(const [result,ready] of [[{held:true},false],[{completed:false,error:{message:'kstuff still unconfirmed'}},false],[{completed:true},false]]){
    const text=startupNotification(result,ready,'192.168.1.2');
    assert.doesNotMatch(text,/Hold L3|TacHen loaded/);assert.match(text,/http:\/\/192\.168\.1\.2:8780/);
  }
  assert.match(startupNotification({completed:false,error:{message:'service version mismatch'}},true,'192.168.1.2'),/service version mismatch/);
  assert.match(startupNotification({degraded:true,error:{message:'Payload Manager unavailable'}},true,'192.168.1.2'),/Hold L3/);
});
