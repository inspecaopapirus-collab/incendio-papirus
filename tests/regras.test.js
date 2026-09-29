/* Testes das regras do Firestore (../firestore.rules) no emulador.
   Rodar com o emulador no ar:  npm run emulador   (ou npx firebase emulators:exec ...)
   Cada linha diz quem tenta o que e se DEVE ser permitido. */
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const F = require("firebase/firestore");

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-regras",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await F.setDoc(F.doc(d, "usuarios", "insp"), { nome: "Insp", perfil: "inspetor", email: "insp@x.com" });
    await F.setDoc(F.doc(d, "usuarios", "adm"), { nome: "Adm", perfil: "admin", email: "adm@x.com" });
    await F.setDoc(F.doc(d, "usuarios", "bloq"), { nome: "Bloq", perfil: "bloqueado", email: "bloq@x.com" });
    await F.setDoc(F.doc(d, "usuarios", "tst"), { nome: "Tst", perfil: "teste_inspetor", email: "tst@x.com" });
    await F.setDoc(F.doc(d, "config", "admins"), { emails: ["chefe@x.com"] });
    await F.setDoc(F.doc(d, "config", "cadastroExt"), { overrides: { "1": { num: "A" }, "2": { num: "B" }, "3": { num: "C" } } });
    await F.setDoc(F.doc(d, "config", "cadastroCustom"), { extAdd: [], extEdit: {} });
    await F.setDoc(F.doc(d, "inspecoes", "i1"), { tipo: "ext" });
  });
  const u = (uid, email) => env.authenticatedContext(uid, { email }).firestore();
  const estranho = u("estranho", "qualquer@x.com"), estranhoAdmEmail = u("fake", "chefe@x.com"),
    insp = u("insp", "insp@x.com"), adm = u("adm", "adm@x.com"), bloq = u("bloq", "bloq@x.com"), tst = u("tst", "tst@x.com"),
    fixo = u("fixoSemCadastro", "emailparaia650@gmail.com"), anon = env.unauthenticatedContext().firestore();
  const casos = [
    ["Estranho (conta criada por fora, sem cadastro) le as inspecoes", false, () => F.getDoc(F.doc(estranho, "inspecoes", "i1"))],
    ["Estranho registra inspecao", false, () => F.setDoc(F.doc(estranho, "inspecoes", "x1"), { tipo: "ext" })],
    ["Estranho cria o proprio cadastro com perfil admin", false, () => F.setDoc(F.doc(estranho, "usuarios", "estranho"), { perfil: "admin" })],
    ["Estranho com e-mail da lista de admins (sem cadastro) grava cadastroCustom", false, () => F.setDoc(F.doc(estranhoAdmEmail, "config", "cadastroCustom"), { x: 1 }, { merge: true })],
    ["Estranho grava em teste_*", false, () => F.setDoc(F.doc(estranho, "teste_config", "x"), { a: 1 })],
    ["Sem login le inspecoes", false, () => F.getDoc(F.doc(anon, "inspecoes", "i1"))],
    ["Inspetor le inspecoes", true, () => F.getDoc(F.doc(insp, "inspecoes", "i1"))],
    ["Inspetor registra inspecao", true, () => F.setDoc(F.doc(insp, "inspecoes", "x2"), { tipo: "ext" })],
    ["Inspetor atualiza nome e ultimo acesso", true, () => F.setDoc(F.doc(insp, "usuarios", "insp"), { nome: "Novo", ultimoAcesso: 1 }, { merge: true })],
    ["Inspetor muda o proprio perfil para admin", false, () => F.setDoc(F.doc(insp, "usuarios", "insp"), { perfil: "admin" }, { merge: true })],
    ["Inspetor troca 2 posicoes no cadastroExt", true, () => F.setDoc(F.doc(insp, "config", "cadastroExt"), { overrides: { "1": { num: "B" }, "2": { num: "A" } } }, { merge: true })],
    ["Inspetor mexe em 3 posicoes no cadastroExt", false, () => F.setDoc(F.doc(insp, "config", "cadastroExt"), { overrides: { "1": { num: "X" }, "2": { num: "Y" }, "3": { num: "Z" } } }, { merge: true })],
    ["Inspetor grava cadastroCustom", false, () => F.setDoc(F.doc(insp, "config", "cadastroCustom"), { x: 1 }, { merge: true })],
    ["Inspetor le auditoria", false, () => F.getDoc(F.doc(insp, "auditoria", "a1"))],
    ["Inspetor grava em teste_*", true, () => F.setDoc(F.doc(insp, "teste_inspecoes", "t1"), { a: 1 })],
    ["Admin grava cadastroCustom so com a diferenca (mergeFields + arrayUnion)", true, async () => {
      await F.setDoc(F.doc(adm, "config", "cadastroCustom"), { extEdit: { "9": { loc: "L" } } }, { mergeFields: [new F.FieldPath("extEdit", "9")] });
      await F.setDoc(F.doc(adm, "config", "cadastroCustom"), { extAdd: F.arrayUnion({ seq: 900 }) }, { merge: true }); }],
    ["Admin cria cadastro de novo usuario", true, () => F.setDoc(F.doc(adm, "usuarios", "novo"), { nome: "N", perfil: "inspetor" })],
    ["Admin encerra acesso de alguem", true, () => F.setDoc(F.doc(adm, "usuarios", "insp"), { perfil: "bloqueado" }, { merge: true })],
    ["Admin le auditoria", true, () => F.getDoc(F.doc(adm, "auditoria", "a1"))],
    ["Admin fixo (sem cadastro ainda) grava cadastroCustom", true, () => F.setDoc(F.doc(fixo, "config", "cadastroCustom"), { y: 1 }, { merge: true })],
    ["Admin fixo cria o proprio cadastro no 1o acesso", true, () => F.setDoc(F.doc(fixo, "usuarios", "fixoSemCadastro"), { email: "emailparaia650@gmail.com", ultimoAcesso: 1 }, { merge: true })],
    ["Bloqueado le o proprio cadastro (para ver 'acesso encerrado')", true, () => F.getDoc(F.doc(bloq, "usuarios", "bloq"))],
    ["Bloqueado le inspecoes", false, () => F.getDoc(F.doc(bloq, "inspecoes", "i1"))],
    ["Bloqueado registra inspecao", false, () => F.setDoc(F.doc(bloq, "inspecoes", "x3"), { tipo: "ext" })],
    ["Perfil teste le inspecoes", true, () => F.getDoc(F.doc(tst, "inspecoes", "i1"))],
    ["Perfil teste registra inspecao real", false, () => F.setDoc(F.doc(tst, "inspecoes", "x4"), { tipo: "ext" })],
  ];
  let falhas = 0;
  for (const [desc, deveria, fn] of casos) {
    let permitiu; try { await fn(); permitiu = true; } catch (e) { permitiu = false; }
    const ok = permitiu === deveria; if (!ok) falhas++;
    console.log(`${ok ? "  ok " : "FALHA"} | ${permitiu ? "PERMITE " : "bloqueia"} | ${desc}`);
  }
  console.log(`\nRegras: ${casos.length - falhas}/${casos.length} como esperado`);
  await env.cleanup();
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
