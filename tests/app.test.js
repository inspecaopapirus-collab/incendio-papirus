/* Testes do app de verdade (index.html no Chromium) contra o emulador do Firestore/Auth,
   com as regras de ../firestore.rules. Nada toca o banco real: o projeto e o "demo-papirus"
   e o SDK do Firebase vem do node_modules em vez da internet.
   Rodar com o emulador no ar:  npm run emulador */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const F = require("firebase/firestore");

const PROJ = "demo-papirus", PORTA = 8765, RAIZ = path.join(__dirname, "..");
const NM = path.join(__dirname, "node_modules");
let HTML = "";

function preparaHtml(modoTeste) {
  let s = fs.readFileSync(process.env.INDEX_HTML || path.join(RAIZ, "index.html"), "utf8");
  const troca = (a, b) => { if (!s.includes(a)) throw new Error("ponto de encaixe sumiu do index.html: " + a); s = s.replace(a, b); };
  troca('<script type="module">', '<script type="module">\nimport { connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";\nimport { connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";');
  troca('projectId: "incendio-papirus"', `projectId: "${PROJ}"`);
  troca("initializeAppCheck(fb,", "(()=>{})(fb,");
  troca("auth=getAuth(fb);", 'auth=getAuth(fb);connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});');
  troca("persistentMultipleTabManager()})});", 'persistentMultipleTabManager()})});connectFirestoreEmulator(db,"127.0.0.1",8080);');
  /* vale para as duas branches: main (false) e teste (true) */
  if (!/const MODO_TESTE = (true|false);/.test(s)) throw new Error("linha do MODO_TESTE sumiu do index.html");
  s = s.replace(/const MODO_TESTE = (true|false);/, `const MODO_TESTE = ${modoTeste ? "true" : "false"};`);
  return s;
}
const servidor = http.createServer((req, res) => {
  if (req.url === "/" || req.url.startsWith("/index.html")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(HTML); }
  const f = path.join(RAIZ, req.url.split("?")[0]);
  if (f.startsWith(RAIZ) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end();
});
const signUp = async email => (await (await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=x",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "senha123", returnSecureToken: true }) })).json()).localId;

let falhas = 0;
const confere = (ok, desc, detalhe) => { if (!ok) falhas++; console.log(`${ok ? "  ok " : "FALHA"} | ${desc}${!ok && detalhe !== undefined ? " -> " + JSON.stringify(detalhe) : ""}`); };

(async () => {
  await new Promise(r => servidor.listen(PORTA, "127.0.0.1", r));
  const env = await initializeTestEnvironment({ projectId: PROJ,
    firestore: { rules: fs.readFileSync(path.join(RAIZ, "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 } });
  const le = async (col, id) => { let d; await env.withSecurityRulesDisabled(async c => { const s = await F.getDoc(F.doc(c.firestore(), col, id)); d = s.exists() ? s.data() : null; }); return d; };
  const escreve = async fn => env.withSecurityRulesDisabled(async c => fn(c.firestore()));
  const zera = async () => {
    await env.clearFirestore();
    await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJ}/accounts`, { method: "DELETE" });
    const adm = await signUp("admin.teste@exemplo.com");
    await signUp("estranho@exemplo.com");
    await escreve(async d => {
      await F.setDoc(F.doc(d, "config", "cadastroCustom"), { extEdit: {}, hidEdit: {}, extAdd: [], hidAdd: [], extDel: [], hidDel: [] });
      await F.setDoc(F.doc(d, "config", "cadastroExt"), { overrides: {} });
      await F.setDoc(F.doc(d, "usuarios", adm), { nome: "Admin Teste", perfil: "admin", email: "admin.teste@exemplo.com" });
    });
  };

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const abre = async () => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.route(u => !u.href.startsWith("http://127.0.0.1"), async r => {
      const u = r.request().url();
      const m = u.match(/gstatic\.com\/firebasejs\/10\.12\.2\/(.*\.js)$/);
      if (m) return r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(NM, "firebase", m[1])) });
      if (u.includes("exceljs.min.js")) return r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(NM, "exceljs", "dist", "exceljs.min.js")) });
      return r.abort();
    });
    const p = await ctx.newPage();
    p.erros = []; p.on("pageerror", e => p.erros.push(e.message));
    p.on("dialog", d => d.accept());
    await p.goto(`http://127.0.0.1:${PORTA}/`);
    return { ctx, p };
  };
  const entra = async (p, email) => {
    await p.fill("#lEmail", email); await p.fill("#lSenha", "senha123");
    await p.evaluate(() => window.entrar());
  };

  /* 1. conta criada por fora, sem cadastro */
  HTML = preparaHtml(false); await zera();
  { const { ctx, p } = await abre(); p.removeAllListeners("dialog"); p.on("dialog", d => d.dismiss());
    await entra(p, "estranho@exemplo.com"); await p.waitForTimeout(5000);
    confere(await p.$eval("#app", e => e.classList.contains("hidden")), "conta sem cadastro nao entra no app");
    confere((await p.textContent("#lMsg")).includes("não liberado"), "conta sem cadastro ve 'acesso ainda nao liberado'");
    await ctx.close(); }

  /* 2. admin sem internet cria local enquanto outro admin mexe no cadastro */
  await zera();
  { const { ctx, p } = await abre();
    await entra(p, "admin.teste@exemplo.com"); await p.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await p.waitForTimeout(3000);
    await ctx.setOffline(true);
    await p.evaluate(() => window.novoLocal());
    await p.fill("#nlSeq", "900"); await p.fill("#nlLoc", "Local criado offline"); await p.fill("#nlCgp", "6 Kg");
    await p.evaluate(() => window.salvaNovoLocal()); await p.waitForTimeout(3500);
    await escreve(d => F.updateDoc(F.doc(d, "config", "cadastroCustom"),
      { "extEdit.77": { loc: "Outro admin" }, extAdd: F.arrayUnion({ seq: 901, loc: "Outro admin" }) }));
    /* ainda sem internet: troca o patrimonio de um hidrante e grava outra coisa depois */
    await p.evaluate(() => window.irPara("hid", "H01")); await p.waitForTimeout(300);
    await p.evaluate(() => window.alterarPatHid()); await p.fill("#novoPatHid", "H99");
    await p.evaluate(() => window.confirmaAlteraPatHid()); await p.waitForTimeout(3500);
    confere((await p.inputValue("#fBusca")).startsWith("H99"), "sem sinal, a tela mantem o patrimonio novo");
    await p.evaluate(() => window.novoLocal());
    await p.fill("#nlSeq", "902"); await p.fill("#nlLoc", "Outro local offline"); await p.fill("#nlCgp", "6 Kg");
    await p.evaluate(() => window.salvaNovoLocal()); await p.waitForTimeout(3500);
    await ctx.setOffline(false); await p.waitForTimeout(8000);
    const cx = await le("config", "cadastroCustom");
    const seqs = cx.extAdd.map(x => x.seq).sort();
    confere(JSON.stringify(seqs) === "[900,901,902]", "locais dos dois admins preservados", seqs);
    confere(cx.extEdit["77"] && cx.extEdit["77"].loc === "Outro admin", "edicao do outro admin preservada", cx.extEdit);
    confere(cx.hidEdit.H01 && cx.hidEdit.H01.pat === "H99", "patrimonio trocado sem sinal chega ao servidor", cx.hidEdit);
    confere(p.erros.length === 0, "sem erro de JavaScript na pagina", p.erros);
    await ctx.close(); }

  /* 3. backup completo: mais inspecoes do que as 400 que o app carrega */
  await zera();
  await escreve(async d => {
    for (let lote = 0; lote < 3; lote++) {
      const b = F.writeBatch(d);
      for (let k = 0; k < 150; k++) { const n = lote * 150 + k;
        b.set(F.doc(d, "inspecoes", "i" + n), { tipo: "ext", eqSeq: 1, mes: "2026-08", data: "2026-08-10", criadoEm: n, conformidade: "C" }); }
      await b.commit();
    }
  });
  { const { ctx, p } = await abre();
    await entra(p, "admin.teste@exemplo.com"); await p.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await p.waitForTimeout(3000);
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), p.evaluate(() => window.backupJSON())]);
    const arq = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    confere(arq.inspecoes.length === 450, "backup tem as 450 inspecoes do banco (o app so carrega 400)", arq.inspecoes.length);
    confere(Array.isArray(arq.condenacoes) && arq.config && arq.config.cadastroCustom, "backup inclui condenacoes e cadastro");
    /* relatorios do mes das inspecoes semeadas: Excel, laudo e vencimentos sem erro */
    await p.evaluate(() => { const s = document.getElementById("pMes"); s.value = "2026-08"; s.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(1500);
    const [xl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.evaluate(() => window.exportXLSX("ext"))]);
    confere(/\.xlsx$/.test(xl.suggestedFilename()), "relatorio Excel de extintores gerado", xl.suggestedFilename());
    const [laudo] = await Promise.all([ctx.waitForEvent("page", { timeout: 30000 }), p.evaluate(() => window.laudoPDF())]);
    await laudo.waitForLoadState();
    const kpis = await laudo.$$eval(".k", ks => Object.fromEntries(ks.map(k => [k.querySelector("span").textContent, k.querySelector("b").textContent])));
    confere(kpis.Inspecionados === "1" && parseInt(kpis.Cobertura) <= 100, "laudo: 1 ponto inspecionado e cobertura ate 100%", kpis);
    await p.evaluate(() => window.renderVenc());
    confere((await p.$eval("#vencExt", e => e.textContent)).length > 0, "aba de vencimentos monta sem erro");
    confere(p.erros.length === 0, "relatorios sem erro de JavaScript", p.erros);
    await ctx.close(); }

  /* 4. MODO_TESTE: grava nas copias teste_* e nao cria conta real */
  HTML = preparaHtml(true); await zera();
  { const { ctx, p } = await abre();
    await entra(p, "admin.teste@exemplo.com"); await p.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await p.waitForTimeout(3000);
    await p.evaluate(() => window.novoLocal());
    await p.fill("#nlSeq", "900"); await p.fill("#nlLoc", "Local teste"); await p.fill("#nlCgp", "6 Kg");
    await p.evaluate(() => window.salvaNovoLocal()); await p.waitForTimeout(3000);
    const real = await le("config", "cadastroCustom"), copia = await le("teste_config", "cadastroCustom");
    confere(real.extAdd.length === 0, "modo teste nao grava no cadastro real", real.extAdd);
    confere(copia && copia.extAdd.some(x => x.seq === 900), "modo teste grava em teste_config", copia);
    await p.evaluate(() => window.cadastrarInspetor());
    await p.fill("#uEmail", "novo@exemplo.com"); await p.fill("#uSenha", "123456");
    await p.evaluate(() => document.querySelector('[onclick="salvaInspetor()"]').click()); await p.waitForTimeout(1500);
    confere((await p.textContent("#toast")).includes("Ambiente de teste"), "modo teste bloqueia criar usuario");
    await ctx.close(); }

  /* 5. inspecao completa pela tela nova: chips, botoes C/NC/NA, fotos e salvar */
  HTML = preparaHtml(false); await zera();
  await escreve(d => F.setDoc(F.doc(d, "config", "cadastroExt"), { overrides: { "1": { num: "90301", tipo: "CO2", carga: "6KG" } } }));
  { const { ctx, p } = await abre();
    await entra(p, "admin.teste@exemplo.com"); await p.waitForSelector("#app:not(.hidden)", { timeout: 20000 }); await p.waitForTimeout(3000);
    await p.evaluate(() => window.escolheEquip("ext", "1"));
    await p.click('#fTipoLocal + .chips button[data-v="CO2"]');
    await p.click('#cgLocal button[data-cg="6 Kg"]');
    const ind = await p.evaluate(() => ({ v: document.getElementById("ck2").value, off: document.querySelector('#ck2 + .opcoes button[data-v="C"]').disabled }));
    confere(ind.v === "NA" && ind.off, "CO2 trava 'Indicador de Pressao' em NA tambem nos botoes", ind);
    await p.click('#ck3 + .opcoes button[data-v="NC"]');
    const nc = await p.evaluate(() => ({ sel: document.getElementById("ck3").value,
      res: document.getElementById("confBox").classList.contains("nc"), f2: document.getElementById("tileF2").classList.contains("obrig") }));
    confere(nc.sel === "NC" && nc.res && nc.f2, "tocar NC marca o item, o resultado fica 'nao conforme' e a Foto 02 fica obrigatoria", nc);
    const img = path.join(RAIZ, "icon-192.png");
    await p.setInputFiles("#fFoto1", img); await p.setInputFiles("#fFoto2", img);
    confere(await p.evaluate(() => document.getElementById("tileF1").classList.contains("tem")), "a foto escolhida aparece em miniatura no quadro");
    await p.fill("#fObs", "Lacre rompido");
    await p.click("#btnSalvar"); await p.waitForTimeout(5000);
    let insp = null;
    await env.withSecurityRulesDisabled(async c => { const q = await F.getDocs(F.collection(c.firestore(), "inspecoes")); insp = q.docs.map(x => x.data())[0] || null; });
    confere(insp && insp.checklist.Lacre === "NC" && insp.conformidade === "NC" && insp.tipoLocal === "CO2" && insp.cargaLocal === "6 Kg" && insp.checklist["Indicador de Pressão"] === "NA",
      "inspecao gravada com o que foi tocado na tela", insp && { chk: insp.checklist, conf: insp.conformidade, ag: insp.tipoLocal, cg: insp.cargaLocal });
    const limpo = await p.evaluate(() => ({ b: document.querySelector('#ck3 + .opcoes button[data-v="C"]').getAttribute("aria-checked"),
      f: document.getElementById("tileF1").classList.contains("tem"), ag: document.querySelectorAll('#fTipoLocal + .chips button[aria-checked="true"]').length }));
    confere(limpo.b === "true" && !limpo.f && limpo.ag === 0, "depois de salvar, botoes, fotos e agente voltam ao inicio", limpo);
    await p.click("#segH");
    await p.click('#hAbrigo + .opcoes button[data-v="Não"]');
    const hid = await p.evaluate(() => ({ v: document.getElementById("hAbrigo").value, nc: document.getElementById("confBox").classList.contains("nc") }));
    confere(hid.v === "Não" && hid.nc, "hidrante: abrigo 'Nao' pelos botoes deixa a inspecao nao conforme", hid);
    confere(p.erros.length === 0, "tela nova sem erro de JavaScript", p.erros);
    await ctx.close(); }

  await browser.close(); await env.cleanup(); servidor.close();
  console.log(`\nApp: ${falhas ? falhas + " falha(s)" : "tudo como esperado"}`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
