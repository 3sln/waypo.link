export const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',jobId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',operationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const features={accountExportEnabled:true,accountDeletionEnabled:true,emailRemovalEnabled:true};
export const account={id:owner,handle:'n.example1234',verifiedEmail:'owner@example.com',termsVersion:'2026-10-11'};
export const initial={loading:false,session:{account,sessionContext:'member'},beamGeneration:1,view:'account-data',locale:'en',config:{termsVersion:'2026-10-11'},data:{account,features,pushDevices:[],storage:{plan:'free'}},route:{kind:'home'}};
export const scheduled={state:'scheduled',basis:'owner',executeAfter:1794000000000,graceDays:30,cancellable:true,notice:{required:true,accepted:false},billing:{pending:true},hold:'notice-unaccepted'};
export const job={id:jobId,owner,purpose:'owner',state:'ready',notBefore:1792700000000,expiresAt:1794500000000,volumes:[{n:1,bytes:4096}]};
export const deletionValues={confirmHandle:'@n.example1234',messages:'on',storage:'on',names:'on'};
