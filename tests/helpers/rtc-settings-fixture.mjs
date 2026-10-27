// RTC-g owner settings as GET /api/rtc/settings answers them (shared by the bl engine and view tests).
const ORIGIN='https://space.example';
const CALL='https://spec.bindle.example/rtc-purposes/call/v1',SCREEN='https://spec.bindle.example/rtc-purposes/screen-share/v1',SYNC='https://spec.bindle.example/rtc-purposes/device-sync/v1';
const APP='https://app.example/client',APP2='https://other.example/client';
export const SETTINGS=Object.freeze({enabled:true,policy:{other:'relay',self:'all',requests:[],autoAccept:{[APP2]:[SYNC]},enabled:true},
 purposes:[{id:CALL,version:1,title:{en:'Call',es:'Llamada'},summary:{en:'Calls.',es:'Llamadas.'},media:['audio','data','video'],alert:true,parties:'any',autoAccept:'never'},
  {id:SCREEN,version:1,title:{en:'Screen sharing',es:'Compartir pantalla'},summary:{en:'Screens.',es:'Pantallas.'},media:['audio','data','screen'],alert:true,parties:'any',autoAccept:'never'},
  {id:SYNC,version:1,title:{en:'Device sync',es:'Sincronización'},summary:{en:'Sync.',es:'Sincroniza.'},media:['data'],alert:false,parties:'self',autoAccept:'self'}],
 contacts:[],apps:[{clientId:APP,name:'Caller',origin:'https://app.example',purposes:[CALL,SYNC]}],sessions:[],missed:[],blocked:[],muted:[],tickets:[],endpoints:[]});
