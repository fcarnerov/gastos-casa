import { useState, useEffect, useMemo, useRef } from "react";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDZvq4hCbtH6BgyyHc4R3b8vlbcTH4u9Wc",
  authDomain: "gastoscasa-2ea81.firebaseapp.com",
  projectId: "gastoscasa-2ea81",
  storageBucket: "gastoscasa-2ea81.firebasestorage.app",
  messagingSenderId: "301239526807",
  appId: "1:301239526807:web:55c69acb575f2e729990d2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = 36;

function toBase36Code(n) {
  let result = "";
  let num = n;
  for (let i = 0; i < 8; i++) {
    result = CHARS[num % BASE] + result;
    num = Math.floor(num / BASE);
  }
  return result;
}

const CATEGORIAS_DEFAULT = [
  "🛒 Supermercado","🏠 Arriendo","🔌 Servicios","🍽️ Restaurantes",
  "🚗 Transporte","💊 Salud","👗 Ropa","🎬 Entretenimiento",
  "📚 Educación","🐾 Mascotas","✈️ Viajes","🔧 Hogar","💻 Tecnología","🎁 Regalos","Otro"
];

const USUARIOS = [
  { id: "felipe", nombre: "Felipe", color: "#C8A96E", bg: "#1a1510" },
  { id: "ella", nombre: "Ella", color: "#9E7BB5", bg: "#130f1a" },
];

function fmtMoney(n) {
  return "$" + Number(n || 0).toLocaleString("es-CL");
}
function fmtFecha(f) {
  if (!f) return "";
  const [y, m, d] = f.split("-");
  return `${d}/${m}/${y}`;
}

async function compressImage(file, maxKB = 300) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        const maxDim = 1200;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        let quality = 0.8;
        const tryCompress = () => {
          canvas.toBlob((blob) => {
            if (blob.size <= maxKB * 1024 || quality <= 0.2) resolve(blob);
            else { quality -= 0.1; tryCompress(); }
          }, "image/jpeg", quality);
        };
        tryCompress();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [pantalla, setPantalla] = useState("resumen");
  const [gastos, setGastos] = useState([]);
  const [categorias, setCategorias] = useState(CATEGORIAS_DEFAULT);
  const [targetFelipe, setTargetFelipe] = useState(55);
  const [contador, setContador] = useState(0);
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0,10), monto: "", categoria: CATEGORIAS_DEFAULT[0], descripcion: "", archivo: null, archivoNombre: "", archivoTipo: "" });
  const [nuevaCat, setNuevaCat] = useState("");
  const [filtroMes, setFiltroMes] = useState("");
  const [filtroUser, setFiltroUser] = useState("todos");
  const [toast, setToast] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef();

  const showToast = (msg, tipo = "ok") => {
    setToast({ msg, tipo });
    setTimeout(() => setToast(null), 3000);
  };

  // Load config from Firestore
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "settings"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.categorias) setCategorias(data.categorias);
        if (data.targetFelipe !== undefined) setTargetFelipe(data.targetFelipe);
        if (data.contador !== undefined) setContador(data.contador);
      }
    });
    return unsub;
  }, []);

  // Load gastos from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "gastos"), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setGastos(data.sort((a, b) => b.fecha?.localeCompare(a.fecha)));
    });
    return unsub;
  }, []);

  const saveConfig = async (updates) => {
    await setDoc(doc(db, "config", "settings"), updates, { merge: true });
  };

  const gastosVis = useMemo(() => {
    return gastos.filter(g => {
      const mesOk = !filtroMes || g.fecha?.startsWith(filtroMes);
      const userOk = filtroUser === "todos" || g.usuario === filtroUser;
      return mesOk && userOk;
    });
  }, [gastos, filtroMes, filtroUser]);

  const totalFelipe = useMemo(() => gastos.filter(g => g.usuario === "felipe").reduce((s, g) => s + Number(g.monto || 0), 0), [gastos]);
  const totalElla = useMemo(() => gastos.filter(g => g.usuario === "ella").reduce((s, g) => s + Number(g.monto || 0), 0), [gastos]);
  const totalGeneral = totalFelipe + totalElla;
  const pctFelipe = totalGeneral > 0 ? (totalFelipe / totalGeneral) * 100 : 0;
  const pctElla = totalGeneral > 0 ? (totalElla / totalGeneral) * 100 : 0;
  const targetElla = 100 - targetFelipe;
  const deberiaFelipe = totalGeneral * (targetFelipe / 100);
  const deberiaElla = totalGeneral * (targetElla / 100);
  const difFelipe = totalFelipe - deberiaFelipe;
  const deudaMsg = Math.abs(difFelipe) < 1 ? "¡Están equilibrados! ✅"
    : difFelipe > 0 ? `Ella te debe ${fmtMoney(Math.abs(difFelipe))}`
    : `Tú le debes ${fmtMoney(Math.abs(difFelipe))} a ella`;

  const porCategoria = useMemo(() => {
    const map = {};
    gastos.forEach(g => { map[g.categoria] = (map[g.categoria] || 0) + Number(g.monto || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [gastos]);

  const handleArchivo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    if (isImage) {
      const compressed = await compressImage(file);
      setForm(f => ({ ...f, archivo: compressed, archivoNombre: file.name.replace(/\.[^.]+$/, ".jpg"), archivoTipo: "image/jpeg" }));
      showToast(`Imagen comprimida: ${Math.round(compressed.size/1024)}KB`);
    } else {
      setForm(f => ({ ...f, archivo: file, archivoNombre: file.name, archivoTipo: file.type }));
    }
  };

  const agregarGasto = async () => {
    if (!form.monto || isNaN(form.monto) || Number(form.monto) <= 0) { showToast("Ingresa un monto válido", "err"); return; }
    if (!form.fecha) { showToast("Ingresa una fecha", "err"); return; }
    setCargando(true);
    try {
      const nuevoContador = contador + 1;
      const codigo = toBase36Code(nuevoContador);
      let archivoURL = null;
      let archivoNombreFinal = form.archivoNombre;

      if (form.archivo) {
        setSubiendo(true);
        const ext = form.archivoNombre.split(".").pop();
        archivoNombreFinal = `${codigo}.${ext}`;
        const storageRef = ref(storage, `recibos/${archivoNombreFinal}`);
        await uploadBytes(storageRef, form.archivo, { contentType: form.archivoTipo });
        archivoURL = await getDownloadURL(storageRef);
        setSubiendo(false);
      }

      await addDoc(collection(db, "gastos"), {
        codigo,
        fecha: form.fecha,
        monto: Number(form.monto),
        categoria: form.categoria,
        descripcion: form.descripcion,
        usuario: usuario,
        archivoURL,
        archivoNombre: archivoNombreFinal,
        creadoEn: new Date().toISOString()
      });

      await saveConfig({ contador: nuevoContador });
      setForm({ fecha: new Date().toISOString().slice(0,10), monto: "", categoria: categorias[0], descripcion: "", archivo: null, archivoNombre: "", archivoTipo: "" });
      if (fileRef.current) fileRef.current.value = "";
      showToast(`Gasto #${codigo} registrado ✅`);
      setPantalla("resumen");
    } catch (err) {
      showToast("Error al guardar: " + err.message, "err");
    }
    setCargando(false);
  };

  const eliminarGasto = async (id) => {
    await deleteDoc(doc(db, "gastos", id));
    showToast("Gasto eliminado");
  };

  const agregarCategoria = async () => {
    if (!nuevaCat.trim()) return;
    const nuevas = [...categorias, nuevaCat.trim()];
    setCategorias(nuevas);
    await saveConfig({ categorias: nuevas });
    setNuevaCat("");
    showToast("Categoría agregada ✅");
  };

  const eliminarCategoria = async (i) => {
    const nuevas = categorias.filter((_, j) => j !== i);
    setCategorias(nuevas);
    await saveConfig({ categorias: nuevas });
  };

  const guardarTarget = async (val) => {
    setTargetFelipe(val);
    await saveConfig({ targetFelipe: val });
  };

  const exportarCSV = () => {
    const headers = ["Código","Fecha","Usuario","Categoría","Descripción","Monto","Archivo"];
    const rows = gastos.map(g => [g.codigo, fmtFecha(g.fecha), g.usuario === "felipe" ? "Felipe" : "Ella", g.categoria, g.descripcion || "", g.monto, g.archivoNombre || ""]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "gastos_casa.csv"; a.click();
    showToast("Exportado ✅");
  };

  // Estilos
  const S = {
    app: { minHeight: "100vh", background: "#0d0d0d", color: "#e8e0d0", fontFamily: "'Georgia', 'Times New Roman', serif", maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: 80 },
    toast: { position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", padding: "12px 28px", borderRadius: 4, color: "#0d0d0d", fontWeight: "bold", zIndex: 9999, fontSize: 13, letterSpacing: 1, boxShadow: "0 4px 30px rgba(0,0,0,0.5)", whiteSpace: "nowrap" },

    // Login
    loginWrap: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0d0d0d", gap: 0 },
    loginTitle: { fontSize: 11, letterSpacing: 8, color: "#666", marginBottom: 12, textTransform: "uppercase" },
    loginLogo: { fontSize: 48, marginBottom: 8 },
    loginBig: { fontSize: 36, fontWeight: "normal", color: "#e8e0d0", marginBottom: 8, letterSpacing: 2 },
    loginSub: { fontSize: 13, color: "#555", marginBottom: 48, letterSpacing: 1 },
    loginBtns: { display: "flex", gap: 16 },
    loginBtn: (u) => ({ border: `1px solid ${u.color}`, background: "transparent", color: u.color, fontFamily: "'Georgia', serif", fontSize: 15, padding: "16px 36px", cursor: "pointer", letterSpacing: 2, transition: "all 0.2s" }),

    // Header
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #1e1e1e", position: "sticky", top: 0, background: "#0d0d0d", zIndex: 100 },
    headerTitle: { fontSize: 11, letterSpacing: 6, color: "#555", textTransform: "uppercase" },
    badge: (u) => ({ fontSize: 11, padding: "4px 14px", border: `1px solid ${u.color}`, color: u.color, letterSpacing: 2 }),
    logoutBtn: { background: "none", border: "1px solid #222", color: "#555", padding: "4px 10px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" },

    // Nav
    nav: { display: "flex", borderBottom: "1px solid #1e1e1e", overflowX: "auto" },
    navBtn: { background: "none", border: "none", color: "#444", padding: "12px 14px", cursor: "pointer", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "inherit", whiteSpace: "nowrap", borderBottom: "2px solid transparent", transition: "all 0.2s" },
    navBtnActive: (u) => ({ color: u.color, borderBottom: `2px solid ${u.color}` }),

    // Main
    main: { padding: "24px 20px" },
    sectionTitle: { fontSize: 11, letterSpacing: 6, color: "#555", textTransform: "uppercase", marginBottom: 24, display: "block" },

    // Cards
    totalCard: (u) => ({ border: `1px solid ${u.color}22`, background: `${u.color}08`, padding: 28, textAlign: "center", marginBottom: 20 }),
    totalLabel: { fontSize: 10, letterSpacing: 4, color: "#555", textTransform: "uppercase", marginBottom: 8, display: "block" },
    totalMonto: { fontSize: 40, fontWeight: "normal", color: "#e8e0d0", letterSpacing: 2 },
    row: { display: "flex", gap: 12, marginBottom: 16 },
    userCard: (u) => ({ flex: 1, border: `1px solid #1e1e1e`, padding: 16, borderTop: `2px solid ${u.color}` }),
    userCardName: { fontSize: 10, letterSpacing: 3, color: "#555", textTransform: "uppercase", marginBottom: 8 },
    userCardMonto: { fontSize: 20, color: "#e8e0d0", marginBottom: 6 },
    userCardPct: { fontSize: 13, color: "#777" },
    diffBadge: (ok, over) => ({ display: "inline-block", fontSize: 10, padding: "3px 10px", letterSpacing: 1, color: ok ? "#2ec4b6" : over ? "#C8A96E" : "#9E7BB5", border: `1px solid ${ok ? "#2ec4b6" : over ? "#C8A96E" : "#9E7BB5"}`, marginTop: 8, marginBottom: 10 }),
    barWrap: { height: 2, background: "#1e1e1e", position: "relative", marginTop: 6 },
    barFill: (u, pct) => ({ height: "100%", width: `${Math.min(pct, 100)}%`, background: u.color, transition: "width 0.8s ease" }),
    barTarget: (pct) => ({ position: "absolute", top: -4, left: `${pct}%`, width: 1, height: 10, background: "#555" }),

    deudaCard: { border: "1px solid #1e1e1e", padding: 20, textAlign: "center", marginBottom: 20 },
    deudaText: { fontSize: 15, color: "#e8e0d0", letterSpacing: 1 },

    catSection: { border: "1px solid #1e1e1e", padding: 20, marginBottom: 16 },
    catRow: { marginBottom: 14 },
    catLabel: { fontSize: 12, color: "#aaa", display: "block", marginBottom: 4 },
    catMonto: { fontSize: 13, color: "#e8e0d0", float: "right", marginTop: -18 },
    catBar: { height: 1, background: "#1e1e1e", marginTop: 4 },
    catBarFill: (pct, u) => ({ height: "100%", width: `${pct}%`, background: u.color, transition: "width 0.8s" }),

    exportBtn: { width: "100%", padding: 14, background: "none", border: "1px solid #2a2a2a", color: "#666", cursor: "pointer", fontSize: 11, letterSpacing: 3, fontFamily: "inherit", textTransform: "uppercase", transition: "all 0.2s" },

    // Form
    formCard: { border: "1px solid #1e1e1e", padding: 24 },
    label: { display: "block", fontSize: 10, letterSpacing: 3, color: "#555", marginBottom: 8, marginTop: 20, textTransform: "uppercase" },
    input: { width: "100%", padding: "12px 0", background: "transparent", border: "none", borderBottom: "1px solid #2a2a2a", color: "#e8e0d0", fontSize: 15, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
    select: { width: "100%", padding: "12px 0", background: "#0d0d0d", border: "none", borderBottom: "1px solid #2a2a2a", color: "#e8e0d0", fontSize: 14, fontFamily: "inherit", outline: "none", appearance: "none" },
    fileBtn: { marginTop: 8, padding: "10px 20px", background: "none", border: "1px solid #2a2a2a", color: "#666", cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "inherit" },
    fileTag: { fontSize: 11, color: "#555", marginTop: 8, letterSpacing: 1 },
    primaryBtn: (u) => ({ width: "100%", padding: 16, background: "none", border: `1px solid ${u.color}`, color: u.color, fontFamily: "inherit", fontSize: 11, letterSpacing: 4, cursor: "pointer", marginTop: 28, textTransform: "uppercase", transition: "all 0.2s" }),

    // Historial
    filtros: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
    inputSm: { padding: "8px 0", background: "transparent", border: "none", borderBottom: "1px solid #2a2a2a", color: "#e8e0d0", fontSize: 13, fontFamily: "inherit", outline: "none" },
    clearBtn: { background: "none", border: "1px solid #2a2a2a", color: "#555", padding: "6px 12px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" },
    empty: { textAlign: "center", color: "#333", padding: 60, fontSize: 13, letterSpacing: 2 },
    gastoCard: (u) => ({ border: "1px solid #1a1a1a", borderLeft: `3px solid ${u.color}`, padding: 16, marginBottom: 10, position: "relative" }),
    gastoCodigo: { fontSize: 10, letterSpacing: 3, color: "#444", marginBottom: 6 },
    gastoTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
    gastoCat: { fontSize: 14, color: "#e8e0d0" },
    gastoMonto: { fontSize: 18, color: "#e8e0d0" },
    gastoBottom: { display: "flex", gap: 12, flexWrap: "wrap" },
    gastoUser: (u) => ({ fontSize: 10, letterSpacing: 2, color: u.color, textTransform: "uppercase" }),
    gastoFecha: { fontSize: 11, color: "#444" },
    gastoDesc: { fontSize: 11, color: "#555", fontStyle: "italic" },
    gastoArch: { marginTop: 8 },
    archLink: { fontSize: 11, color: "#666", letterSpacing: 1 },
    deleteBtn: { position: "absolute", top: 12, right: 12, background: "none", border: "none", color: "#333", cursor: "pointer", fontSize: 14, padding: 4 },

    // Categorias
    catGrid: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 },
    catChip: { border: "1px solid #2a2a2a", padding: "6px 14px", fontSize: 12, color: "#777", display: "flex", alignItems: "center", gap: 8, letterSpacing: 1 },
    chipDel: { background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 },
    addCatRow: { display: "flex", gap: 12 },
    addCatBtn: (u) => ({ background: "none", border: `1px solid ${u.color}`, color: u.color, padding: "10px 20px", cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "inherit", whiteSpace: "nowrap" }),

    // Ajustes
    slider: { width: "100%", marginBottom: 16, accentColor: "#C8A96E", marginTop: 8 },
    targetRow: { display: "flex", gap: 12, marginBottom: 16 },
    targetChip: (u) => ({ flex: 1, border: `1px solid ${u.color}33`, padding: "12px 8px", color: u.color, fontSize: 13, textAlign: "center", letterSpacing: 1 }),
    ajusteBar: { display: "flex", height: 2, marginBottom: 20, marginTop: 4 },
    debeCard: { flex: 1, border: "1px solid #1e1e1e", padding: 14, fontSize: 12, color: "#777", textAlign: "center", lineHeight: 1.8 },
    divider: { height: 1, background: "#1e1e1e", margin: "28px 0" },
    ajusteDesc: { fontSize: 12, color: "#555", marginBottom: 12, letterSpacing: 1 },
  };

  if (!usuario) return (
    <div style={S.loginWrap}>
      <div style={S.loginTitle}>GastosJuntos</div>
      <div style={S.loginLogo}>🏠</div>
      <div style={S.loginBig}>Bienvenido</div>
      <div style={S.loginSub}>¿Quién registra hoy?</div>
      <div style={S.loginBtns}>
        {USUARIOS.map(u => (
          <button key={u.id} style={S.loginBtn(u)} onClick={() => setUsuario(u.id)}
            onMouseEnter={e => { e.target.style.background = u.color; e.target.style.color = "#0d0d0d"; }}
            onMouseLeave={e => { e.target.style.background = "transparent"; e.target.style.color = u.color; }}>
            {u.nombre}
          </button>
        ))}
      </div>
    </div>
  );

  const userObj = USUARIOS.find(u => u.id === usuario);

  return (
    <div style={S.app}>
      {toast && <div style={{ ...S.toast, background: toast.tipo === "err" ? "#ff4d6d" : "#C8A96E" }}>{toast.msg}</div>}

      <header style={S.header}>
        <span style={S.headerTitle}>GastosJuntos</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={S.badge(userObj)}>{userObj.nombre}</span>
          <button style={S.logoutBtn} onClick={() => setUsuario(null)}>↩</button>
        </div>
      </header>

      <nav style={S.nav}>
        {[
          { id: "resumen", label: "Resumen" },
          { id: "agregar", label: "+ Gasto" },
          { id: "historial", label: "Historial" },
          { id: "categorias", label: "Categorías" },
          { id: "ajustes", label: "Ajustes" },
        ].map(n => (
          <button key={n.id}
            style={{ ...S.navBtn, ...(pantalla === n.id ? S.navBtnActive(userObj) : {}) }}
            onClick={() => setPantalla(n.id)}>
            {n.label}
          </button>
        ))}
      </nav>

      <main style={S.main}>

        {pantalla === "resumen" && (
          <div>
            <span style={S.sectionTitle}>Resumen General</span>
            <div style={S.totalCard(userObj)}>
              <span style={S.totalLabel}>Total Gastos</span>
              <div style={S.totalMonto}>{fmtMoney(totalGeneral)}</div>
            </div>

            <div style={S.row}>
              {USUARIOS.map(u => {
                const total = u.id === "felipe" ? totalFelipe : totalElla;
                const pct = u.id === "felipe" ? pctFelipe : pctElla;
                const target = u.id === "felipe" ? targetFelipe : targetElla;
                const diff = pct - target;
                const ok = Math.abs(diff) < 2;
                return (
                  <div key={u.id} style={S.userCard(u)}>
                    <div style={S.userCardName}>{u.nombre}</div>
                    <div style={S.userCardMonto}>{fmtMoney(total)}</div>
                    <div style={S.userCardPct}>{pct.toFixed(1)}% <span style={{ color: "#444", fontSize: 11 }}>/ {target}%</span></div>
                    <div style={S.diffBadge(ok, diff > 0)}>
                      {ok ? "EN META" : diff > 0 ? `▲ +${diff.toFixed(1)}%` : `▼ ${Math.abs(diff).toFixed(1)}%`}
                    </div>
                    <div style={S.barWrap}>
                      <div style={S.barFill(u, pct)} />
                      <div style={S.barTarget(target)} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={S.deudaCard}>
              <div style={{ fontSize: 10, letterSpacing: 4, color: "#444", marginBottom: 8, textTransform: "uppercase" }}>Balance</div>
              <div style={S.deudaText}>{deudaMsg}</div>
            </div>

            {porCategoria.length > 0 && (
              <div style={S.catSection}>
                <div style={{ fontSize: 10, letterSpacing: 4, color: "#444", textTransform: "uppercase", marginBottom: 16 }}>Top Categorías</div>
                {porCategoria.map(([cat, monto]) => (
                  <div key={cat} style={S.catRow}>
                    <span style={S.catLabel}>{cat}</span>
                    <span style={S.catMonto}>{fmtMoney(monto)}</span>
                    <div style={S.catBar}>
                      <div style={S.catBarFill((monto / totalGeneral) * 100, userObj)} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button style={S.exportBtn} onClick={exportarCSV}
              onMouseEnter={e => { e.target.style.borderColor = userObj.color; e.target.style.color = userObj.color; }}
              onMouseLeave={e => { e.target.style.borderColor = "#2a2a2a"; e.target.style.color = "#666"; }}>
              ↓ Exportar a Excel / CSV
            </button>
          </div>
        )}

        {pantalla === "agregar" && (
          <div>
            <span style={S.sectionTitle}>Nuevo Gasto</span>
            <div style={S.formCard}>
              <label style={S.label}>Fecha</label>
              <input type="date" style={S.input} value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />

              <label style={S.label}>Monto ($)</label>
              <input type="number" style={S.input} placeholder="0" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />

              <label style={S.label}>Categoría</label>
              <select style={S.select} value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
                {categorias.map(c => <option key={c} style={{ background: "#0d0d0d" }}>{c}</option>)}
              </select>

              <label style={S.label}>Descripción (opcional)</label>
              <input type="text" style={S.input} placeholder="Ej: Compras del sábado" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />

              <label style={S.label}>Documento / Imagen (opcional)</label>
              <input type="file" ref={fileRef} accept="image/*,.pdf" style={{ display: "none" }} onChange={handleArchivo} />
              <button style={S.fileBtn} onClick={() => fileRef.current?.click()}>📎 Adjuntar archivo</button>
              {form.archivoNombre && <div style={S.fileTag}>✓ {form.archivoNombre} {form.archivo?.size ? `(${Math.round(form.archivo.size/1024)}KB)` : ""}</div>}

              <button style={S.primaryBtn(userObj)} onClick={agregarGasto} disabled={cargando}
                onMouseEnter={e => { e.target.style.background = userObj.color; e.target.style.color = "#0d0d0d"; }}
                onMouseLeave={e => { e.target.style.background = "none"; e.target.style.color = userObj.color; }}>
                {cargando ? (subiendo ? "Subiendo archivo..." : "Guardando...") : "Registrar Gasto"}
              </button>
            </div>
          </div>
        )}

        {pantalla === "historial" && (
          <div>
            <span style={S.sectionTitle}>Historial</span>
            <div style={S.filtros}>
              <input type="month" style={S.inputSm} value={filtroMes} onChange={e => setFiltroMes(e.target.value)} />
              <select style={{ ...S.inputSm, marginLeft: 8 }} value={filtroUser} onChange={e => setFiltroUser(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="felipe">Felipe</option>
                <option value="ella">Ella</option>
              </select>
              {filtroMes && <button style={S.clearBtn} onClick={() => setFiltroMes("")}>✕</button>}
            </div>

            {gastosVis.length === 0
              ? <div style={S.empty}>SIN REGISTROS</div>
              : gastosVis.map(g => {
                const u = USUARIOS.find(u => u.id === g.usuario) || USUARIOS[0];
                return (
                  <div key={g.id} style={S.gastoCard(u)}>
                    <div style={S.gastoCodigo}>#{g.codigo || "--------"}</div>
                    <div style={S.gastoTop}>
                      <span style={S.gastoCat}>{g.categoria}</span>
                      <span style={S.gastoMonto}>{fmtMoney(g.monto)}</span>
                    </div>
                    <div style={S.gastoBottom}>
                      <span style={S.gastoUser(u)}>{u.nombre}</span>
                      <span style={S.gastoFecha}>{fmtFecha(g.fecha)}</span>
                      {g.descripcion && <span style={S.gastoDesc}>{g.descripcion}</span>}
                    </div>
                    {g.archivoURL && (
                      <div style={S.gastoArch}>
                        <a href={g.archivoURL} target="_blank" rel="noreferrer" style={S.archLink}>
                          📎 {g.archivoNombre}
                        </a>
                      </div>
                    )}
                    {g.usuario === usuario && (
                      <button style={S.deleteBtn} onClick={() => eliminarGasto(g.id)}>✕</button>
                    )}
                  </div>
                );
              })
            }
          </div>
        )}

        {pantalla === "categorias" && (
          <div>
            <span style={S.sectionTitle}>Categorías</span>
            <div style={S.catGrid}>
              {categorias.map((c, i) => (
                <div key={i} style={S.catChip}>
                  <span>{c}</span>
                  {i >= CATEGORIAS_DEFAULT.length && (
                    <button style={S.chipDel} onClick={() => eliminarCategoria(i)}>×</button>
                  )}
                </div>
              ))}
            </div>
            <div style={S.addCatRow}>
              <input style={{ ...S.input, flex: 1 }} placeholder="Nueva categoría..." value={nuevaCat}
                onChange={e => setNuevaCat(e.target.value)} onKeyDown={e => e.key === "Enter" && agregarCategoria()} />
              <button style={S.addCatBtn(userObj)} onClick={agregarCategoria}
                onMouseEnter={e => { e.target.style.background = userObj.color; e.target.style.color = "#0d0d0d"; }}
                onMouseLeave={e => { e.target.style.background = "none"; e.target.style.color = userObj.color; }}>
                + Agregar
              </button>
            </div>
          </div>
        )}

        {pantalla === "ajustes" && (
          <div>
            <span style={S.sectionTitle}>Ajustes</span>
            <div style={S.formCard}>
              <div style={{ fontSize: 10, letterSpacing: 4, color: "#555", textTransform: "uppercase", marginBottom: 16 }}>Target de Aporte</div>
              <div style={S.ajusteDesc}>Define qué % debe pagar cada uno del total.</div>

              <label style={S.label}>Felipe: {targetFelipe}%</label>
              <input type="range" min={0} max={100} value={targetFelipe} style={S.slider}
                onChange={e => guardarTarget(Number(e.target.value))} />

              <div style={S.ajusteBar}>
                <div style={{ width: `${targetFelipe}%`, background: "#C8A96E", transition: "width 0.3s" }} />
                <div style={{ width: `${targetElla}%`, background: "#9E7BB5", transition: "width 0.3s" }} />
              </div>

              <div style={S.targetRow}>
                {USUARIOS.map(u => (
                  <div key={u.id} style={S.targetChip(u)}>
                    {u.nombre}<br /><strong>{u.id === "felipe" ? targetFelipe : targetElla}%</strong>
                  </div>
                ))}
              </div>

              <div style={S.ajusteDesc}>Con {fmtMoney(totalGeneral)} total:</div>
              <div style={S.targetRow}>
                <div style={S.debeCard}>Felipe debería<br /><strong style={{ color: "#e8e0d0" }}>{fmtMoney(deberiaFelipe)}</strong></div>
                <div style={S.debeCard}>Ella debería<br /><strong style={{ color: "#e8e0d0" }}>{fmtMoney(deberiaElla)}</strong></div>
              </div>

              <div style={{ ...S.deudaCard, marginTop: 16 }}>
                <div style={S.deudaText}>{deudaMsg}</div>
              </div>

              <div style={S.divider} />
              <div style={{ fontSize: 10, letterSpacing: 4, color: "#555", textTransform: "uppercase", marginBottom: 16 }}>Contador de Registros</div>
              <div style={{ fontSize: 13, color: "#666", letterSpacing: 2 }}>
                Próximo código: <span style={{ color: userObj.color }}>{toBase36Code(contador + 1)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#333", marginTop: 6 }}>Total registros: {contador}</div>

              <div style={S.divider} />
              <div style={{ fontSize: 10, letterSpacing: 4, color: "#555", textTransform: "uppercase", marginBottom: 16 }}>Cambiar Usuario</div>
              <div style={S.loginBtns}>
                {USUARIOS.map(u => (
                  <button key={u.id} style={{ ...S.loginBtn(u), fontSize: 13, padding: "12px 24px" }}
                    onClick={() => { setUsuario(u.id); showToast(`Cambiaste a: ${u.nombre}`); }}
                    onMouseEnter={e => { e.target.style.background = u.color; e.target.style.color = "#0d0d0d"; }}
                    onMouseLeave={e => { e.target.style.background = "transparent"; e.target.style.color = u.color; }}>
                    {u.nombre} {u.id === usuario ? "✓" : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
