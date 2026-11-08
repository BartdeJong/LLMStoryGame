import "./worldMap.css";
import type { Area } from "../world/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;
const COLUMN_GAP = 230;
const ROW_GAP = 104;
const MAP_MARGIN = 40;

export interface WorldMapNode {
  readonly area: Area;
  readonly column: number;
  readonly row: number;
}

export interface WorldMapGraph {
  readonly nodes: readonly WorldMapNode[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
}

export interface WorldMap {
  readonly isOpen: boolean;
  toggle(): void;
  close(): void;
  remove(): void;
}

export function buildWorldMapGraph(areas: readonly Area[], currentAreaId: string): WorldMapGraph {
  const areasById = new Map(areas.map((area) => [area.id, area]));
  if (!areasById.has(currentAreaId)) {
    throw new Error(`The current area "${currentAreaId}" is missing from the explored map.`);
  }

  const columns = new Map<string, number>();
  const queue: string[] = [];
  const visitComponent = (startId: string): void => {
    columns.set(startId, 0);
    queue.push(startId);
    for (let index = 0; index < queue.length; index += 1) {
      const areaId = queue[index]!;
      const area = areasById.get(areaId)!;
      const column = columns.get(areaId)!;
      for (const door of area.doors) {
        const targetId = door.targetAreaId;
        if (targetId && areasById.has(targetId) && !columns.has(targetId)) {
          columns.set(targetId, column + 1);
          queue.push(targetId);
        }
      }
    }
    queue.length = 0;
  };

  visitComponent(currentAreaId);
  for (const area of areas) {
    if (!columns.has(area.id)) visitComponent(area.id);
  }

  const rows = new Map<number, number>();
  const nodes = areas.map((area) => {
    const column = columns.get(area.id)!;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { area, column, row };
  });

  const edges: { from: string; to: string }[] = [];
  const seenEdges = new Set<string>();
  for (const area of areas) {
    for (const door of area.doors) {
      const targetId = door.targetAreaId;
      if (!targetId || !areasById.has(targetId) || targetId === area.id) continue;
      const pair = [area.id, targetId].sort();
      const key = `${pair[0]}\u0000${pair[1]}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ from: area.id, to: targetId });
    }
  }

  return { nodes, edges };
}

function svgElement(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag);
}

function areaLabel(name: string): string {
  return name.length > 23 ? `${name.slice(0, 20)}...` : name;
}

export function createWorldMap(
  container: HTMLElement,
  getAreas: () => readonly Area[],
  getCurrentAreaId: () => string,
): WorldMap {
  const overlay = document.createElement("section");
  overlay.className = "world-map";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "world-map-title");

  const header = document.createElement("header");
  header.className = "world-map-header";
  const title = document.createElement("h2");
  title.id = "world-map-title";
  title.textContent = "Explored places";
  const closeButton = document.createElement("button");
  closeButton.className = "world-map-close";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => close());
  header.append(title, closeButton);

  const viewport = document.createElement("div");
  viewport.className = "world-map-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", "Map of explored places and their paths");
  const svg = svgElement("svg");
  svg.classList.add("world-map-diagram");
  svg.setAttribute("role", "img");
  viewport.append(svg);
  const hint = document.createElement("p");
  hint.className = "world-map-hint";
  hint.textContent = "Press M or Escape to return to exploring.";
  overlay.append(header, viewport, hint);
  container.append(overlay);

  let open = false;
  const render = (): void => {
    const graph = buildWorldMapGraph(getAreas(), getCurrentAreaId());
    const maxColumn = Math.max(...graph.nodes.map((node) => node.column));
    const maxRows = Math.max(...graph.nodes.map((node) => node.row + 1));
    const width = MAP_MARGIN * 2 + maxColumn * COLUMN_GAP + NODE_WIDTH;
    const height = MAP_MARGIN * 2 + maxRows * ROW_GAP;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-label", `Map of ${graph.nodes.length} explored ${graph.nodes.length === 1 ? "area" : "areas"}`);

    const nodesById = new Map(graph.nodes.map((node) => [node.area.id, node]));
    for (const edge of graph.edges) {
      const from = nodesById.get(edge.from)!;
      const to = nodesById.get(edge.to)!;
      const fromX = MAP_MARGIN + from.column * COLUMN_GAP;
      const fromY = MAP_MARGIN + from.row * ROW_GAP + NODE_HEIGHT / 2;
      const toY = MAP_MARGIN + to.row * ROW_GAP + NODE_HEIGHT / 2;
      const path = svgElement("path");
      if (from.column === to.column) {
        const bendX = fromX + NODE_WIDTH + 30;
        path.setAttribute("d", `M ${fromX + NODE_WIDTH} ${fromY} C ${bendX} ${fromY}, ${bendX} ${toY}, ${fromX + NODE_WIDTH} ${toY}`);
      } else {
        const left = from.column < to.column ? from : to;
        const right = from.column < to.column ? to : from;
        const leftY = MAP_MARGIN + left.row * ROW_GAP + NODE_HEIGHT / 2;
        const rightY = MAP_MARGIN + right.row * ROW_GAP + NODE_HEIGHT / 2;
        const startX = MAP_MARGIN + left.column * COLUMN_GAP + NODE_WIDTH;
        const endX = MAP_MARGIN + right.column * COLUMN_GAP;
        const middleX = (startX + endX) / 2;
        path.setAttribute("d", `M ${startX} ${leftY} C ${middleX} ${leftY}, ${middleX} ${rightY}, ${endX} ${rightY}`);
      }
      path.classList.add("world-map-path");
      const pathTitle = svgElement("title");
      pathTitle.textContent = `${from.area.name} connects to ${to.area.name}`;
      path.append(pathTitle);
      svg.append(path);
    }

    for (const node of graph.nodes) {
      const x = MAP_MARGIN + node.column * COLUMN_GAP;
      const y = MAP_MARGIN + node.row * ROW_GAP;
      const group = svgElement("g");
      group.classList.add("world-map-node");
      if (node.area.id === getCurrentAreaId()) group.classList.add("world-map-node-current");
      group.setAttribute("aria-label", `${node.area.name}, ${node.area.biome}`);
      const rect = svgElement("rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(NODE_WIDTH));
      rect.setAttribute("height", String(NODE_HEIGHT));
      rect.setAttribute("rx", "8");
      const name = svgElement("text");
      name.classList.add("world-map-node-name");
      name.setAttribute("x", String(x + 12));
      name.setAttribute("y", String(y + 27));
      name.textContent = areaLabel(node.area.name);
      const biome = svgElement("text");
      biome.classList.add("world-map-node-biome");
      biome.setAttribute("x", String(x + 12));
      biome.setAttribute("y", String(y + 47));
      biome.textContent = node.area.biome;
      group.append(rect, name, biome);
      svg.append(group);
    }
  };

  const close = (): void => {
    open = false;
    overlay.hidden = true;
  };

  return {
    get isOpen(): boolean {
      return open;
    },
    toggle(): void {
      if (open) {
        close();
        return;
      }
      render();
      open = true;
      overlay.hidden = false;
      closeButton.focus();
    },
    close,
    remove(): void {
      close();
      overlay.remove();
    },
  };
}
