import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Cpu,
  Factory as FactoryIcon,
  Globe2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  CompanyHierarchy,
  FactoryTree,
  MachineStatus,
  MachineSummary,
  RegionTree,
} from "../../types/digitalTwin";

interface IndustrialNetworkMapProps {
  hierarchy: CompanyHierarchy | null;
  liveStates: Record<string, { status: MachineStatus; oee_pct?: number }>;
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string | null) => void;
}

const INDIA_CENTER: [number, number] = [21.5, 78.9];
const INDIA_DEFAULT_ZOOM = 5;
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

// Keep broad-zoom regional label anchors separated from nearby city factory pins
const REGION_LABEL_OFFSETS: Record<string, [number, number]> = {
  "reg-south-india": [11.65, 79.4],
  "reg-emea-de": [30.1, 77.0],
  "reg-na-mw": [19.4, 71.9],
};

function statusColorHex(
  machines: MachineSummary[],
  liveStates: Record<string, { status: MachineStatus }>
): string {
  const statuses = machines.map((m) => (liveStates[m.id] ?? m.state)?.status ?? "Unknown");
  if (statuses.includes("Fault")) return "#DC2626";
  if (statuses.includes("Maintenance") || statuses.includes("Idle")) return "#D97706";
  if (statuses.includes("Running")) return "#059669";
  return "#64748B";
}

function compactCityLabel(factory: FactoryTree): string {
  if (factory.location_label) {
    return factory.location_label.split(",")[0].trim();
  }
  return factory.name;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const IndustrialNetworkMap: React.FC<IndustrialNetworkMapProps> = ({
  hierarchy,
  liveStates,
  selectedRegionId,
  onSelectRegion,
}) => {
  const navigate = useNavigate();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const regionLabelsLayerRef = useRef<L.LayerGroup | null>(null);
  const factoryMarkersLayerRef = useRef<L.LayerGroup | null>(null);
  const lastCameraKeyRef = useRef<string>("");

  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(INDIA_DEFAULT_ZOOM);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [basemapStatus, setBasemapStatus] = useState<"loading" | "ready" | "error">("loading");

  const factoryIndex = useMemo(() => {
    const map = new Map<string, { factory: FactoryTree; region: RegionTree }>();
    hierarchy?.regions.forEach((r) =>
      r.factories.forEach((f) => map.set(f.id, { factory: f, region: r }))
    );
    return map;
  }, [hierarchy]);

  // Clear stale factory selection if RBAC role/hierarchy changed
  useEffect(() => {
    if (selectedFactoryId && hierarchy && !factoryIndex.has(selectedFactoryId)) {
      setSelectedFactoryId(null);
    }
  }, [hierarchy, selectedFactoryId, factoryIndex]);

  // Initialize Leaflet Map strictly once per mounted container and clean up completely on unmount
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    // Ensure no duplicate Leaflet instance remains on the DOM node
    const existingLeafletContainer = container as HTMLDivElement & { _leaflet_id?: number };
    if (existingLeafletContainer._leaflet_id) {
      delete existingLeafletContainer._leaflet_id;
    }
    container.innerHTML = "";

    const map = L.map(container, {
      center: INDIA_CENTER,
      zoom: INDIA_DEFAULT_ZOOM,
      minZoom: 4,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: true,
    });

    const tileLayer = L.tileLayer(OSM_TILE_URL, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      crossOrigin: true,
    });

    let tilesLoaded = 0;
    let tilesErrored = 0;

    tileLayer.on("loading", () => {
      if (tilesLoaded === 0) {
        setBasemapStatus("loading");
      }
    });
    tileLayer.on("tileload", () => {
      tilesLoaded += 1;
      tilesErrored = 0;
      setBasemapStatus("ready");
    });
    tileLayer.on("load", () => {
      if (tilesLoaded > 0) {
        setBasemapStatus("ready");
      }
    });
    tileLayer.on("tileerror", () => {
      tilesErrored += 1;
      if (tilesLoaded === 0 && tilesErrored >= 2) {
        setBasemapStatus("error");
      }
    });

    tileLayer.addTo(map);
    const regionLayer = L.layerGroup().addTo(map);
    const factoryLayer = L.layerGroup().addTo(map);

    tileLayerRef.current = tileLayer;
    regionLabelsLayerRef.current = regionLayer;
    factoryMarkersLayerRef.current = factoryLayer;
    mapInstanceRef.current = map;

    map.on("zoomend", () => {
      setMapZoom(map.getZoom());
    });
    map.on("click", () => {
      setSelectedFactoryId(null);
      setSearchOpen(false);
    });

    const invalidate = () => {
      if (mapInstanceRef.current === map) {
        map.invalidateSize({ animate: false });
      }
    };
    const rafId = window.requestAnimationFrame(invalidate);
    const timerId = window.setTimeout(invalidate, 180);
    window.addEventListener("resize", invalidate);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(invalidate);
      resizeObserver.observe(container);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      window.removeEventListener("resize", invalidate);
      resizeObserver?.disconnect();
      tileLayer.off();
      tileLayer.remove();
      regionLayer.clearLayers();
      regionLayer.remove();
      factoryLayer.clearLayers();
      factoryLayer.remove();
      map.off();
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      regionLabelsLayerRef.current = null;
      factoryMarkersLayerRef.current = null;
    };
  }, []);

  // Render region labels (broad zoom only, separated from pins) and real-coordinate factory markers
  useEffect(() => {
    const regionLayer = regionLabelsLayerRef.current;
    const factoryLayer = factoryMarkersLayerRef.current;
    if (!regionLayer || !factoryLayer) return;

    regionLayer.clearLayers();
    factoryLayer.clearLayers();
    if (!hierarchy) return;

    const showRegionPills = mapZoom <= 7;

    hierarchy.regions.forEach((reg) => {
      if (reg.factories.length === 0) return;

      if (showRegionPills) {
        const regCoords =
          REGION_LABEL_OFFSETS[reg.id] ??
          ([
            (reg.factories.reduce((s, f) => s + (f.latitude ?? 20.5), 0) / reg.factories.length) + 1.1,
            reg.factories.reduce((s, f) => s + (f.longitude ?? 78.9), 0) / reg.factories.length,
          ] as [number, number]);
        const isRegSelected = selectedRegionId === reg.id && !selectedFactoryId;

        const regIcon = L.divIcon({
          className: "ps032-region-label",
          iconSize: [0, 0],
          iconAnchor: [0, 0],
          html: `<button type="button" style="transform:translate(-50%,-50%);white-space:nowrap;border-radius:9999px;border:1px solid ${
            isRegSelected ? "#2563EB" : "#CBD5E1"
          };background:${isRegSelected ? "#2563EB" : "rgba(255,255,255,0.94)"};color:${
            isRegSelected ? "#FFFFFF" : "#14213D"
          };padding:2px 9px;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(20,33,61,0.12);cursor:pointer;">${escapeHtml(
            reg.name
          )}</button>`,
        });

        const regMarker = L.marker(regCoords, { icon: regIcon, zIndexOffset: 100 });
        regMarker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedFactoryId(null);
          onSelectRegion(reg.id);
        });
        regMarker.addTo(regionLayer);
      }

      reg.factories.forEach((fac) => {
        const lat = fac.latitude ?? 20.5937;
        const lng = fac.longitude ?? 78.9629;
        const fMachines = fac.production_lines.flatMap((l) => l.machines);
        const dotColor = statusColorHex(fMachines, liveStates);
        const isSelected = selectedFactoryId === fac.id;
        const compactLabel = compactCityLabel(fac);

        const pinHtml = `
          <div title="${escapeHtml(fac.name)}" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-86%);cursor:pointer;">
            <div style="width:${isSelected ? 34 : 28}px;height:${isSelected ? 34 : 28}px;border-radius:9999px;background:${
              isSelected ? "#2563EB" : "#FFFFFF"
            };border:2.5px solid ${isSelected ? "#1D4ED8" : dotColor};box-shadow:0 3px 10px rgba(20,33,61,${
              isSelected ? "0.34" : "0.18"
            });display:flex;align-items:center;justify-content:center;">
              <span style="width:10px;height:10px;border-radius:9999px;background:${
                isSelected ? "#FFFFFF" : dotColor
              };display:block;"></span>
            </div>
            <div style="margin-top:3px;white-space:nowrap;border-radius:6px;border:1px solid ${
              isSelected ? "#2563EB" : "#DCE6F2"
            };background:${isSelected ? "#2563EB" : "rgba(255,255,255,0.96)"};color:${
              isSelected ? "#FFFFFF" : "#14213D"
            };padding:1px 7px;font-size:11px;font-weight:600;box-shadow:0 2px 5px rgba(20,33,61,0.12);">
              ${escapeHtml(compactLabel)}
            </div>
          </div>
        `;

        const markerIcon = L.divIcon({
          className: "ps032-factory-marker",
          iconSize: [0, 0],
          iconAnchor: [0, 0],
          html: pinHtml,
        });

        const marker = L.marker([lat, lng], {
          icon: markerIcon,
          zIndexOffset: isSelected ? 1000 : 500,
        });

        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectRegion(reg.id);
          setSelectedFactoryId(fac.id);
        });

        marker.addTo(factoryLayer);
      });
    });
  }, [hierarchy, liveStates, mapZoom, selectedRegionId, selectedFactoryId, onSelectRegion]);

  // Move camera ONLY when selection explicitly changes (not on 8s telemetry polls)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !hierarchy) return;

    const cameraKey = `${selectedRegionId ?? "all"}:${selectedFactoryId ?? ""}`;
    if (lastCameraKeyRef.current === cameraKey) return;
    lastCameraKeyRef.current = cameraKey;

    map.invalidateSize({ animate: false });

    if (selectedFactoryId) {
      const hit = factoryIndex.get(selectedFactoryId);
      if (hit) {
        map.flyTo(
          [hit.factory.latitude ?? 20.5937, hit.factory.longitude ?? 78.9629],
          11,
          { duration: 0.65 }
        );
      }
      return;
    }

    if (selectedRegionId) {
      const reg = hierarchy.regions.find((r) => r.id === selectedRegionId);
      if (reg && reg.factories.length > 0) {
        if (reg.factories.length === 1) {
          const f = reg.factories[0];
          map.flyTo([f.latitude ?? 20.5937, f.longitude ?? 78.9629], 9, { duration: 0.65 });
        } else {
          const bounds = L.latLngBounds(
            reg.factories.map((f) => [f.latitude ?? 20.5937, f.longitude ?? 78.9629])
          );
          map.flyToBounds(bounds.pad(0.45), { duration: 0.65, maxZoom: 9 });
        }
      }
      return;
    }

    map.flyTo(INDIA_CENTER, INDIA_DEFAULT_ZOOM, { duration: 0.65 });
  }, [selectedFactoryId, selectedRegionId, factoryIndex, hierarchy]);

  const searchResults = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q || !hierarchy) {
      return { regions: [], factories: [], machines: [] };
    }
    const regions = hierarchy.regions.filter(
      (r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
    );
    const factories: Array<{ factory: FactoryTree; region: RegionTree }> = [];
    const machines: Array<{ machine: MachineSummary; factory: FactoryTree; region: RegionTree }> = [];
    hierarchy.regions.forEach((r) =>
      r.factories.forEach((f) => {
        if (
          f.name.toLowerCase().includes(q) ||
          (f.location_label ?? "").toLowerCase().includes(q) ||
          f.code.toLowerCase().includes(q)
        ) {
          factories.push({ factory: f, region: r });
        }
        f.production_lines.forEach((l) =>
          l.machines.forEach((m) => {
            if (m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q)) {
              machines.push({ machine: m, factory: f, region: r });
            }
          })
        );
      })
    );
    return {
      regions: regions.slice(0, 3),
      factories: factories.slice(0, 5),
      machines: machines.slice(0, 6),
    };
  }, [searchText, hierarchy]);

  const resetToIndiaView = () => {
    setSelectedFactoryId(null);
    onSelectRegion(null);
    lastCameraKeyRef.current = "all:";
    mapInstanceRef.current?.invalidateSize({ animate: false });
    mapInstanceRef.current?.flyTo(INDIA_CENTER, INDIA_DEFAULT_ZOOM, { duration: 0.6 });
  };

  const selectedFactoryEntry = selectedFactoryId ? factoryIndex.get(selectedFactoryId) ?? null : null;
  const selectedFactoryStats = useMemo(() => {
    if (!selectedFactoryEntry) return null;
    const machines = selectedFactoryEntry.factory.production_lines.flatMap((l) => l.machines);
    const faultCount = machines.filter(
      (m) => (liveStates[m.id] ?? m.state)?.status === "Fault"
    ).length;
    const runningCount = machines.filter(
      (m) => (liveStates[m.id] ?? m.state)?.status === "Running"
    ).length;
    return {
      machineCount: machines.length,
      faultCount,
      runningCount,
    };
  }, [selectedFactoryEntry, liveStates]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#F1F6FD]">
      {/* Top Floating Search Bar + Region Chips */}
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-[400] flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="pointer-events-auto relative w-full sm:max-w-sm">
          <div className="flex items-center rounded-lg border border-[#DCE6F2] bg-white px-3 py-2 shadow-md">
            <Search className="mr-2 h-4 w-4 shrink-0 text-[#2563EB]" />
            <input
              type="text"
              value={searchText}
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setSearchText(e.target.value);
                setSearchOpen(true);
              }}
              placeholder="Search regions, factories, or machines…"
              className="w-full bg-transparent text-xs text-[#14213D] placeholder:text-slate-400 focus:outline-none"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => {
                  setSearchText("");
                  setSearchOpen(false);
                }}
                aria-label="Clear search"
                className="ml-1 rounded p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {searchOpen && searchText.trim().length > 0 && (
            <div className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-[#DCE6F2] bg-white p-1.5 text-xs shadow-lg">
              {searchResults.regions.length === 0 &&
              searchResults.factories.length === 0 &&
              searchResults.machines.length === 0 ? (
                <div className="p-2.5 text-center text-slate-500">No matching regions, factories, or machines.</div>
              ) : (
                <div className="space-y-1">
                  {searchResults.regions.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setSelectedFactoryId(null);
                        onSelectRegion(r.id);
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-[#EAF2FC]"
                    >
                      <Globe2 className="h-3.5 w-3.5 text-[#2563EB]" />
                      <span className="font-semibold text-[#14213D]">{r.name}</span>
                      <span className="ml-auto text-[10px] text-slate-500">Region</span>
                    </button>
                  ))}
                  {searchResults.factories.map(({ factory, region }) => (
                    <button
                      key={factory.id}
                      type="button"
                      onClick={() => {
                        onSelectRegion(region.id);
                        setSelectedFactoryId(factory.id);
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-[#EAF2FC]"
                    >
                      <FactoryIcon className="h-3.5 w-3.5 text-[#2563EB]" />
                      <span className="font-semibold text-[#14213D]">{factory.name}</span>
                      <span className="ml-auto text-[10px] text-slate-500">{factory.location_label}</span>
                    </button>
                  ))}
                  {searchResults.machines.map(({ machine, factory }) => (
                    <button
                      key={machine.id}
                      type="button"
                      onClick={() => navigate(`/digital-twin/machine/${machine.id}`)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-[#EAF2FC]"
                    >
                      <Cpu className="h-3.5 w-3.5 text-[#2563EB]" />
                      <span className="font-semibold text-[#14213D]">
                        {machine.code} — {machine.name}
                      </span>
                      <span className="ml-auto text-[10px] text-slate-500">{factory.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Region Filter Chips */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={resetToIndiaView}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm transition ${
              !selectedRegionId
                ? "border-[#2563EB] bg-[#2563EB] text-white"
                : "border-[#DCE6F2] bg-white text-[#14213D] hover:bg-[#EAF2FC]"
            }`}
          >
            All India
          </button>
          {(hierarchy?.regions ?? []).map((reg) => {
            const isSelected = selectedRegionId === reg.id;
            return (
              <button
                key={reg.id}
                type="button"
                onClick={() => {
                  setSelectedFactoryId(null);
                  onSelectRegion(reg.id);
                }}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm transition ${
                  isSelected
                    ? "border-[#2563EB] bg-[#2563EB] text-white"
                    : "border-[#DCE6F2] bg-white text-[#14213D] hover:bg-[#EAF2FC]"
                }`}
              >
                {reg.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Full-Width / Full-Height Leaflet Map Canvas */}
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Selected Factory Compact Floating Popup Card (only visible when a marker is clicked) */}
      {selectedFactoryEntry && selectedFactoryStats && (
        <div
          role="dialog"
          aria-label={selectedFactoryEntry.factory.name}
          className="absolute bottom-6 left-4 z-[450] w-[calc(100%-2rem)] max-w-sm rounded-xl border border-[#DCE6F2] bg-white p-4 shadow-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                {selectedFactoryEntry.region.name}
              </span>
              <h3 className="mt-0.5 text-sm font-bold text-[#14213D]">
                {selectedFactoryEntry.factory.name}
              </h3>
              <div className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                <MapPin className="h-3.5 w-3.5 text-[#2563EB]" />
                <span>{selectedFactoryEntry.factory.location_label ?? "India"}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFactoryId(null)}
              aria-label="Close factory details"
              className="rounded-md p-1 text-slate-400 hover:bg-[#EAF2FC] hover:text-[#14213D]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] p-2.5 text-center font-mono text-xs">
            <div>
              <div className="text-[10px] text-slate-500">Machines</div>
              <div className="font-bold text-[#14213D]">{selectedFactoryStats.machineCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Running</div>
              <div className="font-bold text-emerald-700">{selectedFactoryStats.runningCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Faults</div>
              <div
                className={`font-bold ${
                  selectedFactoryStats.faultCount > 0 ? "text-red-600" : "text-emerald-700"
                }`}
              >
                {selectedFactoryStats.faultCount}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate(`/digital-twin/factory/${selectedFactoryEntry.factory.id}`)}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            View Factory
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Basemap Tile Loading / Error Status */}
      {basemapStatus === "loading" && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[400] rounded-lg border border-[#DCE6F2] bg-white/95 px-2.5 py-1 text-[11px] font-medium text-[#334155] shadow-sm">
          Loading OpenStreetMap tiles…
        </div>
      )}
      {basemapStatus === "error" && (
        <div className="absolute bottom-3 left-3 z-[400] flex items-center gap-2 rounded-lg border border-amber-300 bg-white/95 px-3 py-1.5 text-[11px] text-[#14213D] shadow-md">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>Map tiles failed to load cleanly. Retry to reload tiles.</span>
          <button
            type="button"
            onClick={() => {
              setBasemapStatus("loading");
              mapInstanceRef.current?.invalidateSize({ animate: false });
              tileLayerRef.current?.redraw();
            }}
            className="inline-flex items-center gap-1 rounded bg-[#2563EB] px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-700"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {/* Standard Google Maps Bottom-Right Zoom & Reset Controls */}
      <div className="absolute bottom-7 right-3 z-[400] flex flex-col overflow-hidden rounded-lg border border-[#DCE6F2] bg-white shadow-md">
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => mapInstanceRef.current?.zoomIn()}
          className="flex h-8 w-8 items-center justify-center border-b border-[#DCE6F2] text-[#14213D] hover:bg-[#EAF2FC]"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => mapInstanceRef.current?.zoomOut()}
          className="flex h-8 w-8 items-center justify-center border-b border-[#DCE6F2] text-[#14213D] hover:bg-[#EAF2FC]"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Reset map view"
          aria-label="Reset map view"
          onClick={resetToIndiaView}
          className="flex h-8 w-8 items-center justify-center text-[#2563EB] hover:bg-[#EAF2FC]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
