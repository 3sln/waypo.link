import {validateConfiguration} from '@3sln/waypo/node';
import {nativeCapacityProfile} from './native-capacity.fixture.mjs';
// Finite fixture configuration only, not economic or disk-capacity evidence.
export function financialOperatorFixtureConfiguration(database){const profile=nativeCapacityProfile();const configuration={...profile,issuer:'http://localhost:20991/api/auth',adminUrl:'http://localhost:20992/',installationId:'financial-operator',database,authSecret:'private-node-financial-operator-secret32',admission:'closed',allowInsecureLoopback:true,services:{...profile.services,logs:true,blobs:true,logLimits:{logs:16,receipts:4096},blobTransfers:{maxBytes:134217728},limits:{accountBytes:10000000000,stagingBytes:268435456,stages:2,attachments:4096},storageCapacity:{revision:'financial-operator',accountPhysicalBytes:64000000000,fleetPhysicalBytes:64001310720,maxAccounts:1,accountRows:1000000,fleetRows:1000156}}};
 // Exact current reference envelope: ordinary4190, owner6736, essential2050.
 // 4096 cannot fund128MiB reference reads/owner exports; period minima are
 // ordinary8802, owner6736 and essential2050, covered by configured reserves.
 for(const lane of ['account','app','fleet'])configuration.services.workBudget[lane]={capacity:6736,refillPerMinute:6736};
 return validateConfiguration(configuration);}
