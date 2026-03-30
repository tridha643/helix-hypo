import {
  DEP_DEPTH_IN_CYCLE,
  TOPO_ORDER_UNAVAILABLE,
  type DependencyAnalysis,
  type ImportEdge,
} from "./types.js";

// The topological order only covers the acyclic portion of the dependency graph.
// Files in cycles are removed before Kahn's algorithm runs, so edges that touch a
// cyclic vertex do not constrain the remaining order.

function buildAdjacency(fileIds: string[], importEdges: ImportEdge[]): {
  adjacency: Map<string, Set<string>>;
  reverseAdjacency: Map<string, Set<string>>;
} {
  const adjacency = new Map<string, Set<string>>();
  const reverseAdjacency = new Map<string, Set<string>>();

  for (const fileId of fileIds) {
    adjacency.set(fileId, new Set());
    reverseAdjacency.set(fileId, new Set());
  }

  for (const edge of importEdges) {
    adjacency.get(edge.fromFileId)?.add(edge.toFileId);
    reverseAdjacency.get(edge.toFileId)?.add(edge.fromFileId);
  }

  return {
    adjacency,
    reverseAdjacency,
  };
}

function computeCycleIds(adjacency: Map<string, Set<string>>): {
  cycleIdByFileId: Map<string, string>;
  inCycleFileIds: Set<string>;
} {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stronglyConnectedComponents: string[][] = [];

  const orderedFileIds = [...adjacency.keys()].sort((left, right) => left.localeCompare(right));

  function strongConnect(fileId: string): void {
    indices.set(fileId, index);
    lowLinks.set(fileId, index);
    index += 1;
    stack.push(fileId);
    onStack.add(fileId);

    const neighbors = [...(adjacency.get(fileId) ?? [])].sort((left, right) => left.localeCompare(right));
    for (const neighbor of neighbors) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor);
        lowLinks.set(fileId, Math.min(lowLinks.get(fileId)!, lowLinks.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLinks.set(fileId, Math.min(lowLinks.get(fileId)!, indices.get(neighbor)!));
      }
    }

    if (lowLinks.get(fileId) !== indices.get(fileId)) {
      return;
    }

    const component: string[] = [];
    let current = stack.pop();
    while (current) {
      onStack.delete(current);
      component.push(current);
      if (current === fileId) {
        break;
      }
      current = stack.pop();
    }

    stronglyConnectedComponents.push(component.sort((left, right) => left.localeCompare(right)));
  }

  for (const fileId of orderedFileIds) {
    if (!indices.has(fileId)) {
      strongConnect(fileId);
    }
  }

  const cycleComponents = stronglyConnectedComponents
    .filter((component) => {
      if (component.length > 1) {
        return true;
      }

      const onlyMember = component[0];
      return adjacency.get(onlyMember)?.has(onlyMember) ?? false;
    })
    .sort((left, right) => left[0]!.localeCompare(right[0]!));

  const cycleIdByFileId = new Map<string, string>();
  const inCycleFileIds = new Set<string>();

  cycleComponents.forEach((component, indexInCycles) => {
    const cycleId = `cycle-${indexInCycles}`;
    for (const fileId of component) {
      cycleIdByFileId.set(fileId, cycleId);
      inCycleFileIds.add(fileId);
    }
  });

  return {
    cycleIdByFileId,
    inCycleFileIds,
  };
}

export function analyzeDependencyGraph(
  fileIds: string[],
  importEdges: ImportEdge[]
): DependencyAnalysis {
  const orderedFileIds = [...fileIds].sort((left, right) => left.localeCompare(right));
  const { adjacency, reverseAdjacency } = buildAdjacency(orderedFileIds, importEdges);
  const { cycleIdByFileId, inCycleFileIds } = computeCycleIds(adjacency);

  const importCountByFileId = new Map<string, number>();
  const importedByCountByFileId = new Map<string, number>();

  for (const fileId of orderedFileIds) {
    importCountByFileId.set(fileId, adjacency.get(fileId)?.size ?? 0);
    importedByCountByFileId.set(fileId, reverseAdjacency.get(fileId)?.size ?? 0);
  }

  const acyclicFileIds = orderedFileIds.filter((fileId) => !inCycleFileIds.has(fileId));
  const topoIndegree = new Map<string, number>(acyclicFileIds.map((fileId) => [fileId, 0]));

  for (const fileId of acyclicFileIds) {
    for (const neighbor of adjacency.get(fileId) ?? []) {
      if (!inCycleFileIds.has(neighbor)) {
        topoIndegree.set(neighbor, (topoIndegree.get(neighbor) ?? 0) + 1);
      }
    }
  }

  const ready = acyclicFileIds
    .filter((fileId) => (topoIndegree.get(fileId) ?? 0) === 0)
    .sort((left, right) => left.localeCompare(right));
  const topoOrderByFileId = new Map<string, number>(
    orderedFileIds.map((fileId) => [fileId, TOPO_ORDER_UNAVAILABLE])
  );
  let topoIndex = 0;

  while (ready.length > 0) {
    const current = ready.shift()!;
    topoOrderByFileId.set(current, topoIndex);
    topoIndex += 1;

    const neighbors = [...(adjacency.get(current) ?? [])]
      .filter((neighbor) => !inCycleFileIds.has(neighbor))
      .sort((left, right) => left.localeCompare(right));

    for (const neighbor of neighbors) {
      const nextIndegree = (topoIndegree.get(neighbor) ?? 0) - 1;
      topoIndegree.set(neighbor, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(neighbor);
        ready.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  const depDepthByFileId = new Map<string, number>();

  function computeDepth(fileId: string): number {
    if (inCycleFileIds.has(fileId)) {
      return DEP_DEPTH_IN_CYCLE;
    }

    const cached = depDepthByFileId.get(fileId);
    if (cached !== undefined) {
      return cached;
    }

    const neighbors = [...(adjacency.get(fileId) ?? [])].sort((left, right) => left.localeCompare(right));
    if (neighbors.length === 0) {
      depDepthByFileId.set(fileId, 0);
      return 0;
    }

    let maxChildDepth = 0;
    for (const neighbor of neighbors) {
      if (inCycleFileIds.has(neighbor)) {
        depDepthByFileId.set(fileId, DEP_DEPTH_IN_CYCLE);
        return DEP_DEPTH_IN_CYCLE;
      }

      const childDepth = computeDepth(neighbor);
      if (childDepth < 0) {
        depDepthByFileId.set(fileId, DEP_DEPTH_IN_CYCLE);
        return DEP_DEPTH_IN_CYCLE;
      }

      maxChildDepth = Math.max(maxChildDepth, childDepth + 1);
    }

    depDepthByFileId.set(fileId, maxChildDepth);
    return maxChildDepth;
  }

  for (const fileId of orderedFileIds) {
    if (inCycleFileIds.has(fileId)) {
      depDepthByFileId.set(fileId, DEP_DEPTH_IN_CYCLE);
    } else {
      computeDepth(fileId);
    }
  }

  return {
    cycleIdByFileId,
    depDepthByFileId,
    importedByCountByFileId,
    importCountByFileId,
    inCycleFileIds,
    topoOrderByFileId,
  };
}
