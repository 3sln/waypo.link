export default `:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17313b;background:#edf4f3;font-synthesis:none;line-height:1.5}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top right,#cceae5 0,transparent 48%),#edf4f3}
a{color:#08685f;text-underline-offset:4px}
a:hover{text-decoration-thickness:2px}
a:focus-visible,button:focus-visible{outline:3px solid #ba6409;outline-offset:4px}
.shell{max-width:1040px;margin:auto;padding:36px 28px 64px}
.masthead{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:40px}
.wordmark{font-size:24px;font-weight:800;letter-spacing:-1px;color:#153e43;text-decoration:none}
.masthead a:last-child{font-size:14px}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:750;color:#087369;margin:0 0 8px}
h1{font-size:clamp(30px,5vw,44px);line-height:1.1;letter-spacing:-1.5px;margin:0 0 14px}
.intro{max-width:620px;color:#50636a;margin:0 0 28px;font-size:17px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(270px,.72fr);gap:24px;align-items:start}
.card{background:#fff;border:1px solid #d4e2df;border-radius:20px;padding:28px;box-shadow:0 8px 28px #214d4610;min-width:0}
.card h2{font-size:20px;margin:0 0 18px}
.price{display:flex;align-items:baseline;gap:8px;margin:0 0 8px}
.price strong{font-size:46px;letter-spacing:-2px;line-height:1.1}
.price span{color:#607179}
.included{font-weight:650;margin:0 0 18px}
.quiet{font-size:14px;color:#607179;margin:12px 0 0}
.pill{display:inline-block;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#def2ec;color:#176253;margin-bottom:18px}
#status{padding:14px 16px;background:#eff6f4;border:1px solid #d5e5df;border-radius:10px;margin:0 0 18px;font-weight:600;overflow-wrap:anywhere}
#status.error{background:#fff3ed;color:#913c1d;border-color:#efc6b1}
#details{margin:0;display:grid;grid-template-columns:minmax(130px,.8fr) minmax(0,1fr);gap:0 16px}
dt,dd{padding:12px 0;border-bottom:1px solid #edf1ef;margin:0;overflow-wrap:anywhere}
dt{color:#607179;font-size:14px}
dd{font-weight:550;font-size:14px}
.actions{display:grid;gap:10px;margin-top:22px}
button{font:inherit;font-size:14px;font-weight:650;border:1px solid #b9d2cb;border-radius:10px;padding:12px 16px;min-height:46px;cursor:pointer;background:#fff;color:#175f57;text-align:center;transition:background .15s}
button:hover:not(:disabled){background:#eaf6f2}
button.primary{background:#126e61;color:#fff;border-color:#126e61}
button.primary:hover:not(:disabled){background:#0b584e}
button:disabled{background:#f1f3f2;color:#84908e;border-color:#e0e6e3;cursor:not-allowed}
.rule{border:0;border-top:1px solid #e4ebe8;margin:22px 0}
.notice{font-size:13px;color:#607179;line-height:1.6}
#availability{min-height:20px}
footer{margin-top:28px;font-size:13px;color:#607179;max-width:700px}
@media(max-width:650px){.shell{padding:24px 18px 36px}
.masthead{margin-bottom:30px;align-items:start}
.masthead a:last-child{max-width:140px;text-align:right}
.grid{grid-template-columns:1fr;gap:18px}
.card{padding:22px;border-radius:16px}
.intro{font-size:16px}
#details{grid-template-columns:1fr;gap:0}
dt{padding-bottom:2px;border:0}
dd{padding-top:0;padding-bottom:12px}
h1{letter-spacing:-1px}
.price strong{font-size:40px}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important}
}

`;
