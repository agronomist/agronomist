/** Minimal slice of Leaflet that the pin map uses. Leaflet itself is loaded from a CDN only when the map is first opened. */
interface LMap {
  setView(c: [number, number], z: number): LMap;
  on(ev: string, fn: (e: { latlng: { lat: number; lng: number } }) => void): LMap;
  invalidateSize(): void;
  getZoom(): number;
}
interface LMarker {
  setLatLng(c: [number, number]): LMarker;
  addTo(m: LMap): LMarker;
}
interface LStatic {
  map(el: HTMLElement, o?: object): LMap;
  tileLayer(url: string, o: object): { addTo(m: LMap): unknown };
  circleMarker(c: [number, number], o: object): LMarker;
}

const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
const SRI = { js: "sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH", css: "sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H" };

let loading: Promise<LStatic> | null = null;
function loadLeaflet(): Promise<LStatic> {
  const w = window as unknown as { L?: LStatic };
  if (w.L) return Promise.resolve(w.L);
  loading ??= new Promise<LStatic>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${LEAFLET}.css`;
    css.integrity = SRI.css;
    css.crossOrigin = "";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = `${LEAFLET}.js`;
    js.integrity = SRI.js;
    js.crossOrigin = "";
    js.onload = () => (w.L ? resolve(w.L) : reject(new Error("Map library did not start")));
    js.onerror = () => {
      loading = null;
      reject(new Error("Could not load the map library"));
    };
    document.head.appendChild(js);
  });
  return loading;
}

export interface PinMap {
  show(lat: number, lon: number): void;
  mark(lat: number, lon: number): void;
}

/** Create a click-to-pin map in `el`. `onPick` receives the clicked point with longitude wrapped to -180..180. */
export async function createPinMap(el: HTMLElement, start: { lat: number; lon: number }, onPick: (lat: number, lon: number) => void): Promise<PinMap> {
  const L = await loadLeaflet();
  const map = L.map(el, { minZoom: 4, maxBounds: [[33, -108], [52, -77]], maxBoundsViscosity: 0.9 }).setView([start.lat, start.lon], 5);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const marker = L.circleMarker([start.lat, start.lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#c0392b", fillOpacity: 0.95 }).addTo(map);
  map.on("click", (e) => {
    const lon = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180;
    marker.setLatLng([e.latlng.lat, lon]);
    onPick(e.latlng.lat, lon);
  });
  return {
    show(lat, lon) {
      map.invalidateSize();
      map.setView([lat, lon], Math.max(map.getZoom(), 5));
      marker.setLatLng([lat, lon]);
    },
    mark(lat, lon) {
      marker.setLatLng([lat, lon]);
    },
  };
}
