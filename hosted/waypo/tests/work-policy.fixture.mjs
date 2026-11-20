// Finite test values only. This is not a launch cost budget or signup approval.
const bucket=()=>({capacity:1024,refillPerMinute:1024});
export function tokenWorkProfile(){return {revision:'fixture-only-work-v1',reservationUnits:16,costs:{lookup:1,refresh:1},maxFamilies:32,inactiveFamilyMs:600000,lookup:bucket(),account:bucket(),family:bucket(),fleet:bucket()};}
// Storage terminal maintenance prepays 2050 weighted units in the current
// closed funding matrix. Keep this functional fixture finite and admit that
// envelope; token-work buckets above remain independently unchanged.
const storageBucket=()=>({capacity:4096,refillPerMinute:4096});
export function serviceWorkProfile(){return {revision:'fixture-only-work-v1',reservationUnits:16,costs:{'storage-read':1,'storage-write':1,'notifications-read':1,'notifications-write':1,'signaling-read':1,'signaling-write':1,'subscription-open':1},account:storageBucket(),app:storageBucket(),fleet:storageBucket(),ingress:storageBucket(),maxActiveApps:32,inactiveAppMs:600000};}

export function periodWorkProfile(){return {revision:'fixture-only-period-v1',daily:{units:100000,essentialReserve:10000,ownerReserve:10000},monthly:{units:1000000,essentialReserve:100000,ownerReserve:100000}};}

export function storageCapacityProfile(){return {revision:'fixture-only-storage-v1',accountPhysicalBytes:134217728,fleetPhysicalBytes:537919488,maxAccounts:4,accountRows:16384,fleetRows:65676};}
