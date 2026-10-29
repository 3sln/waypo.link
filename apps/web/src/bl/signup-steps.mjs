export const paidSignupPlan=value=>['paid','plus','ultra'].includes(value);
export const signupRequiresContact=state=>state.config.signupContactRequired===true||state.signupMode==='system';
export function signupSteps(state){return [...state.signupMode==='system'?['invitation']:state.signupMode==='onboarding'?['onboarding','name']:[],...state.signupMode!=='onboarding'&&paidSignupPlan(state.signupPlan)?['plan']:[],...signupRequiresContact(state)?['contact',...state.signupChannel==='email'?['email']:[]]:[],'terms','credential'];}
export function signupStep(state){const steps=signupSteps(state);return steps.includes(state.signupStep)?state.signupStep:steps[0];}

export function signupAge(state){const requirement=state.config.ageRequirement??{},minimum=paidSignupPlan(state.signupPlan)?requirement.paidMinimumAge:requirement.minimumAge;return Number.isSafeInteger(minimum)&&minimum>=0?minimum:18;}
export const signupBlocked=state=>state.signupMode!=='system'&&state.config.ageRequirement?.blocked===true;
