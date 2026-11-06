/* Backup semanal do Firestore (roda no GitHub Actions, ver .github/workflows/backup.yml).
   Le todas as colecoes, menos as fotos (pesadas: ficam so no banco), as copias do
   ambiente de teste (teste_*) e os erros dos aparelhos. Grava um JSON no formato do
   backup manual do app (versao 2), com as colecoes extras no fim.
   Credencial: a conta de servico em GOOGLE_APPLICATION_CREDENTIALS. Com
   FIRESTORE_EMULATOR_HOST definido, le o emulador (usado nos testes). */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { writeFileSync } from "node:fs";

const projectId = process.env.PROJETO || "incendio-papirus";
const saida = process.argv[2] || "backup.json";
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { credential: applicationDefault(), projectId });
const db = getFirestore();

const FORA = new Set(["fotos", "erros"]);
const limpa = v => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(limpa);
  if (v && typeof v === "object" && v.constructor === Object) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpa(x)]));
  return v;
};

const colecoes = (await db.listCollections()).map(c => c.id).filter(n => !FORA.has(n) && !n.startsWith("teste_")).sort();
const dados = {}, contagem = {};
for (const n of colecoes) {
  const snap = await db.collection(n).get();
  dados[n] = snap.docs.map(d => ({ id: d.id, ...limpa(d.data()) }));
  contagem[n] = snap.size;
}
const config = Object.fromEntries((dados.config || []).map(({ id, ...r }) => [id, r]));
delete dados.config;
const backup = {
  geradoEm: new Date().toISOString(), versao: 2, origem: "backup automatico semanal (GitHub Actions)",
  contagem, ...dados, config,
  cadastroOverrides: (config.cadastroExt && config.cadastroExt.overrides) || {},
  observacao: "Fotos nao incluidas (colecao fotos). Demais colecoes completas; ambiente de teste e erros dos aparelhos ficam de fora.",
};
writeFileSync(saida, JSON.stringify(backup, null, 1));
console.log("Backup gerado:", saida);
for (const [n, q] of Object.entries(contagem)) console.log(`  ${n}: ${q}`);
if (!contagem.inspecoes) { console.error("Nenhuma inspecao lida: backup suspeito."); process.exit(1); }
