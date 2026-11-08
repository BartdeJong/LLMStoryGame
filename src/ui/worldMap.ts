import "./worldMap.css";
import type { Area } from "../world/types";
import { activateGamepadFocus } from "../input/focus";

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

  const positions = new Map<string, { column: number; row: number }>();
  const occupied = new Set<string>();
  const positionKey = (column: number, row: number): string => `${column},${row}`;
  const placeComponent = (startId: string, start: { column: number; row: number }): void => {
    positions.set(startId, start);
    occupied.add(positionKey(start.column, start.row));
    const queue = [startId];
    for (let index = 0; index < queue.length; index += 1) {
      const areaId = queue[index]!;
      const area = areasById.get(areaId)!;
      const position = positions.get(areaId)!;
      for (const door of area.doors) {
        const targetId = door.targetAreaId;
        if (!targetId || !areasById.has(targetId) || positions.has(targetId)) continue;
        const dx = door.x - (area.width - 1) / 2;
        const dy = door.y - (area.height - 1) / 2;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const direction = horizontal
          ? { column: dx < 0 ? -1 : 1, row: 0 }
          : { column: 0, row: dy < 0 ? -1 : 1 };
        let candidate: { column: number; row: number } | undefined;
        for (let distance = 1; !candidate; distance += 1) {
          for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
            const column = position.column + direction.column * distance + (horizontal ? 0 : offset);
            const row = position.row + direction.row * distance + (horizontal ? offset : 0);
            if (!occupied.has(positionKey(column, row))) {
              candidate = { column, row };
              break;
            }
          }
        }
        positions.set(targetId, candidate);
        occupied.add(positionKey(candidate.column, candidate.row));
        queue.push(targetId);
      }
    }
  };

  placeComponent(currentAreaId, { column: 0, row: 0 });
  for (const area of areas) {
    if (positions.has(area.id)) continue;
    const maxColumn = Math.max(...[...positions.values()].map(({ column }) => column));
    let startColumn = maxColumn + 2;
    while (occupied.has(positionKey(startColumn, 0))) startColumn += 1;
    placeComponent(area.id, { column: startColumn, row: 0 });
  }

  const minColumn = Math.min(...[...positions.values()].map(({ column }) => column));
  const minRow = Math.min(...[...positions.values()].map(({ row }) => row));
  const nodes = areas.map((area) => {
    const position = positions.get(area.id)!;
    return {
      area,
      column: position.column - minColumn,
      row: position.row - minRow,
    };
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
  title.textContent = "Explored places · North ↑";
  const centerButton = document.createElement("button");
  centerButton.className = "world-map-close";
  centerButton.type = "button";
  centerButton.textContent = "Center on me";
  const closeButton = document.createElement("button");
  closeButton.className = "world-map-close";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => close());
  header.append(title, centerButton, closeButton);

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
  hint.textContent = "Paths follow the compass: ↑ north · → east · ↓ south · ← west. Press M or Escape to return.";
  overlay.append(header, viewport, hint);
  container.append(overlay);

  let open = false;
  let graph: WorldMapGraph | null = null;
  let returnFocus: HTMLElement | null = null;
  const centerCurrent = (): void => {
    if (!graph) return;
    const current = graph.nodes.find((node) => node.area.id === getCurrentAreaId());
    if (!current) return;
    const x = MAP_MARGIN + current.column * COLUMN_GAP + NODE_WIDTH / 2;
    const y = MAP_MARGIN + current.row * ROW_GAP + NODE_HEIGHT / 2;
    viewport.scrollLeft = Math.max(0, x - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, y - viewport.clientHeight / 2);
  };
  centerButton.addEventListener("click", centerCurrent);

  const render = (): void => {
    graph = buildWorldMapGraph(getAreas(), getCurrentAreaId());
    const maxColumn = Math.max(...graph.nodes.map((node) => node.column));
    const maxRows = Math.max(...graph.nodes.map((node) => node.row + 1));
    const width = MAP_MARGIN * 2 + maxColumn * COLUMN_GAP + NODE_WIDTH;
    const height = MAP_MARGIN * 2 + maxRows * ROW_GAP;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-label", `Map of ${graph.nodes.length} explored ${graph.nodes.length === 1 ? "area" : "areas"}`);
    title.textContent = `Explored places · ${graph.nodes.length} · North ↑`;
    hint.textContent = `${graph.nodes.length} ${graph.nodes.length === 1 ? "place" : "places"} explored · Paths follow the compass: ↑ north · → east · ↓ south · ← west. Press M or Escape to return.`;

    const nodesById = new Map(graph.nodes.map((node) => [node.area.id, node]));
    for (const edge of graph.edges) {
      const from = nodesById.get(edge.from)!;
      const to = nodesById.get(edge.to)!;
      const fromX = MAP_MARGIN + from.column * COLUMN_GAP;
      const fromY = MAP_MARGIN + from.row * ROW_GAP + NODE_HEIGHT / 2;
      const toX = MAP_MARGIN + to.column * COLUMN_GAP;
      const toY = MAP_MARGIN + to.row * ROW_GAP + NODE_HEIGHT / 2;
      const path = svgElement("path");
      if (from.column === to.column && from.row !== to.row) {
        const leftY = from.row < to.row ? fromY : toY;
        const rightY = from.row < to.row ? toY : fromY;
        const x = fromX + NODE_WIDTH / 2;
        path.setAttribute("d", `M ${x} ${leftY + NODE_HEIGHT / 2} C ${x} ${(leftY + rightY) / 2}, ${x} ${(leftY + rightY) / 2}, ${x} ${rightY - NODE_HEIGHT / 2}`);
      } else if (from.row === to.row && from.column !== to.column) {
        const leftX = Math.min(fromX, toX);
        const rightX = Math.max(fromX, toX);
        const y = fromY;
        path.setAttribute("d", `M ${leftX + NODE_WIDTH} ${y} C ${(leftX + rightX + NODE_WIDTH) / 2} ${y}, ${(leftX + rightX + NODE_WIDTH) / 2} ${y}, ${rightX} ${y}`);
      } else if (from.column === to.column) {
        const bendX = fromX + NODE_WIDTH + 30;
        path.setAttribute("d", `M ${fromX + NODE_WIDTH} ${fromY} C ${bendX} ${fromY}, ${bendX} ${toY}, ${fromX + NODE_WIDTH} ${toY}`);
      } else {
        const left = from.column < to.column ? from : to;
        const right = from.column < to.column ? to : from;
        const leftY = MAP_MARGIN + left.row * ROW_GAP + NODE_HEIGHT / 2;
        const rightY = MAP_MARGIN + right.row * ROW_GAP + NODE_HEIGHT / 2;
        const leftX = MAP_MARGIN + left.column * COLUMN_GAP;
        const rightX = MAP_MARGIN + right.column * COLUMN_GAP;
        const middleX = (leftX + rightX + NODE_WIDTH) / 2;
        path.setAttribute("d", `M ${leftX + NODE_WIDTH} ${leftY} C ${middleX} ${leftY}, ${middleX} ${rightY}, ${rightX} ${rightY}`);
      }
      path.classList.add("world-map-path");
      const pathTitle = svgElement("title");
      const direction = to.row < from.row ? "north"
        : to.row > from.row ? "south"
          : to.column < from.column ? "west" : "east";
      pathTitle.textContent = `${from.area.name} connects ${direction} to ${to.area.name}`;
      path.append(pathTitle);
      svg.append(path);
    }

    for (const node of graph.nodes) {
      const x = MAP_MARGIN + node.column * COLUMN_GAP;
      const y = MAP_MARGIN + node.row * ROW_GAP;
      const current = node.area.id === getCurrentAreaId();
      const group = svgElement("g");
      group.classList.add("world-map-node");
      if (current) group.classList.add("world-map-node-current");
      group.setAttribute("aria-label", `${node.area.name}, ${node.area.biome}${current ? ", current location" : ""}`);
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
      biome.textContent = current ? `${node.area.biome} · YOU ARE HERE` : node.area.biome;
      const nodeTitle = svgElement("title");
      nodeTitle.textContent = `${node.area.name} · ${node.area.biome}${current ? " · You are here" : ""}`;
      group.append(rect, name, biome, nodeTitle);
      svg.append(group);
    }
  };

  const close = (): void => {
    open = false;
    overlay.hidden = true;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  };
  const stopGamepadFocus = activateGamepadFocus(overlay, {
    isActive: () => open,
    onBack: close,
  });

  return {
    get isOpen(): boolean {
      return open;
    },
    toggle(): void {
      if (open) {
        close();
        return;
      }
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      render();
      open = true;
      overlay.hidden = false;
      centerCurrent();
      closeButton.focus();
    },
    close,
    remove(): void {
      close();
      stopGamepadFocus();
      overlay.remove();
    },
  };
}
