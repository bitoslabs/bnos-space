const $ = (id) => document.getElementById(id);
const words = {
  en: {heading:'Understand a credential',intro:'Check each dimension. A signature alone does not establish trust.',notice:'Synthetic demonstration only. These are fixed test results, not live verification.',scenario:'Explore a result',signature:'Signature',issuer:'Issuer',trust:'Issuer policy',registration:'Issuer registration',evidence:'Evidence references',expiry:'Expires at',revocation:'Revocation',checked:'Verified at',live:'Live verification unavailable',privacy:'No credentials are uploaded. This page stores nothing and contacts no relays.'},
  lo: {heading:'ກວດເບິ່ງໃບຮັບຮອງ',intro:'ກວດເບິ່ງແຕ່ລະດ້ານ. ລາຍເຊັນຢ່າງດຽວບໍ່ຢືນຢັນຄວາມໄວ້ວາງໃຈ.',notice:'ຕົວຢ່າງສັງເຄາະເທົ່ານັ້ນ. ເປັນຜົນທົດສອບຄົງທີ່ ບໍ່ແມ່ນການກວດສອບປັດຈຸບັນ.',scenario:'ເລືອກຜົນຕົວຢ່າງ',signature:'ລາຍເຊັນ',issuer:'ຜູ້ອອກ',trust:'ນະໂຍບາຍຜູ້ອອກ',registration:'ການຂຶ້ນທະບຽນຜູ້ອອກ',evidence:'ເອກະສານອ້າງອີງ',expiry:'ໝົດອາຍຸ',revocation:'ການຍົກເລີກ',checked:'ເວລາກວດສອບ',live:'ຍັງບໍ່ເປີດການກວດສອບປັດຈຸບັນ',privacy:'ບໍ່ອັບໂຫຼດໃບຮັບຮອງ. ໜ້ານີ້ບໍ່ເກັບຂໍ້ມູນ ແລະ ບໍ່ຕິດຕໍ່ relay.'}
};
let results = [];
function render() {
  $('result').replaceChildren();
  const lang = $('language').value === 'lo' ? 'lo' : 'en';
  document.documentElement.lang = lang;
  const w = words[lang];
  for (const id of ['heading','intro','notice','live','privacy']) $(id).textContent = w[id];
  $('scenario-label').textContent = w.scenario;
  for (const option of $('scenario').options) option.textContent = results.find(x => x.mode === option.value)?.view.status.labels[lang] || option.value;
  const view = results.find(x => x.mode === $('scenario').value)?.view;
  if (!view) return;
  const title = document.createElement('h2'); title.textContent = view.status.labels[lang];
  const hint = document.createElement('p'); hint.textContent = view.status.hints[lang];
  const dl = document.createElement('dl');
  for (const [key,value] of [['signature',view.signature],['issuer',view.issuer.org_ref],['trust',view.issuer.trust],['registration',view.issuer.registration],['evidence',view.evidence.join(' · ')],['expiry',view.expiry.expires_at],['revocation',view.revocation.labels[lang]],['checked',view.verified_at]]) {
    const dt = document.createElement('dt'); dt.textContent = w[key];
    const dd = document.createElement('dd'); dd.textContent = value; dl.append(dt,dd);
  }
  const note = document.createElement('p'); note.textContent = view.authority_note[lang];
  $('result').append(title,hint,dl,note);
}
$('language').addEventListener('change',render);
$('scenario').addEventListener('change',render);
try {
  const response = await fetch('./synthetic-results.json', {cache:'no-store',credentials:'omit'});
  if (!response.ok) throw new Error('unavailable');
  const data = await response.json();
  if (data.synthetic !== true || !Array.isArray(data.cases) || data.cases.length !== 6) throw new Error('invalid');
  results = data.cases;
  render();
} catch {
  $('result').replaceChildren();
  $('error').textContent = 'Sample unavailable / ບໍ່ມີຕົວຢ່າງ';
  $('scenario').disabled = true;
}
