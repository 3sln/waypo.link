// Finite test values only. This is not a launch cost budget or signup approval.
const bucket=()=>({capacity:1024,refillPerMinute:1024});
export function tokenWorkProfile(){return {revision:'fixture-only-work-v1',reservationUnits:16,costs:{lookup:1,refresh:1},maxFamilies:32,inactiveFamilyMs:600000,lookup:bucket(),account:bucket(),family:bucket(),fleet:bucket()};}
export function serviceWorkProfile(){return {revision:'fixture-only-work-v1',reservationUnits:16,costs:{'storage-read':1,'storage-write':1,'notifications-read':1,'notifications-write':1,'signaling-read':1,'signaling-write':1,'subscription-open':1},account:bucket(),app:bucket(),fleet:bucket(),ingress:bucket(),maxActiveApps:32,inactiveAppMs:600000};}

export function periodWorkProfile(){return {revision:'fixture-only-period-v1',daily:{units:100000,essentialReserve:10000},monthly:{units:1000000,essentialReserve:100000}};}
