#!/usr/bin/env bun
/**
 * analyze_parallel_phases.ts - Analyze task for phased parallel breakdown
 *
 * Determines t-shirt size, decomposition principle, phase count, and parallelization strategy.
 *
 * Usage:
 *   bun analyze_parallel_phases.ts <task-file-path> [--json] [--dry-run]
 *
 * Output (JSON):
 *   {
 *     "task_name": "h-implement-system",
 *     "tshirt_size": "M",
 *     "decomposition_principle": "api-first",
 *     "recommended_phases": 3,
 *     "max_parallel_per_phase": 4,
 *     "should_generate_specs": true,
 *     "should_visualize": false,
 *     "breakdown_needed": true,
 *     "phase_structure": [
 *       { "phase": 1, "type": "parallel", "estimated_tasks": 3 },
 *       { "phase": 2, "type": "sequential", "estimated_tasks": 1 },
 *       { "phase": 3, "type": "parallel", "estimated_tasks": 2 }
 *     ],
 *     "reasoning": "..."
 *   }
 */

import { existsSync, statSync } from "fs";
import { basename, dirname, join } from "path";

// T-shirt sizes with thresholds
type TShirtSize = "XS" | "S" | "M" | "L" | "XL";

interface SizeThresholds {
  minCriteria: number;
  maxCriteria: number;
  minFiles: number;
  maxFiles: number;
  breakdown: boolean;
  subtaskRange: [number, number];
  generateSpecs: boolean;
  generateVisualization: boolean;
}

const SIZE_THRESHOLDS: Record<TShirtSize, SizeThresholds> = {
  XS: {
    minCriteria: 1,
    maxCriteria: 2,
    minFiles: 1,
    maxFiles: 1,
    breakdown: false,
    subtaskRange: [0, 0],
    generateSpecs: false,
    generateVisualization: false,
  },
  S: {
    minCriteria: 3,
    maxCriteria: 4,
    minFiles: 2,
    maxFiles: 3,
    breakdown: true,
    subtaskRange: [2, 3],
    generateSpecs: false,
    generateVisualization: false,
  },
  M: {
    minCriteria: 5,
    maxCriteria: 7,
    minFiles: 4,
    maxFiles: 6,
    breakdown: true,
    subtaskRange: [4, 6],
    generateSpecs: true,
    generateVisualization: false,
  },
  L: {
    minCriteria: 8,
    maxCriteria: 10,
    minFiles: 7,
    maxFiles: 10,
    breakdown: true,
    subtaskRange: [6, 8],
    generateSpecs: true,
    generateVisualization: true,
  },
  XL: {
    minCriteria: 11,
    maxCriteria: Infinity,
    minFiles: 11,
    maxFiles: Infinity,
    breakdown: true,
    subtaskRange: [8, 12],
    generateSpecs: true,
    generateVisualization: true,
  },
};

// Decomposition principles and their indicators
type DecompositionPrinciple =
  | "api-first"
  | "domain-first"
  | "infrastructure-first"
  | "test-first"
  | "interface-first";

interface PrincipleIndicators {
  keywords: string[];
  description: string;
  phasePattern: ("parallel" | "sequential")[];
}

const DECOMPOSITION_PRINCIPLES: Record<DecompositionPrinciple, PrincipleIndicators> = {
  "api-first": {
    keywords: ["api", "endpoint", "rest", "graphql", "service", "backend", "server", "microservice"],
    description: "Define API contracts first, then parallelize implementation",
    phasePattern: ["sequential", "parallel", "sequential"],
  },
  "domain-first": {
    keywords: ["model", "entity", "schema", "database", "domain", "data", "type", "interface"],
    description: "Start with data model, then build services around it",
    phasePattern: ["sequential", "parallel", "parallel"],
  },
  "infrastructure-first": {
    keywords: ["deploy", "ci", "cd", "docker", "kubernetes", "terraform", "aws", "cloud", "pipeline"],
    description: "Set up infrastructure before implementation",
    phasePattern: ["sequential", "parallel", "sequential"],
  },
  "test-first": {
    keywords: ["test", "spec", "tdd", "bdd", "coverage", "e2e", "integration test", "unit test"],
    description: "Define tests early for parallel implementation",
    phasePattern: ["parallel", "parallel", "sequential"],
  },
  "interface-first": {
    keywords: ["ui", "component", "frontend", "react", "vue", "angular", "design", "ux", "layout"],
    description: "Define component interfaces first, then implement",
    phasePattern: ["sequential", "parallel", "sequential"],
  },
};

interface PhaseStructure {
  phase: number;
  type: "parallel" | "sequential";
  estimated_tasks: number;
  description: string;
}

interface ParallelPhaseAnalysis {
  task_name: string;
  task_file: string;
  branch: string | null;
  success_criteria_count: number;
  tshirt_size: TShirtSize;
  decomposition_principle: DecompositionPrinciple;
  recommended_phases: number;
  max_parallel_per_phase: number;
  should_generate_specs: boolean;
  should_visualize: boolean;
  breakdown_needed: boolean;
  phase_structure: PhaseStructure[];
  reasoning: string;
  integration_points: string[];
  error?: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const frontmatter: Record<string, string> = {};

  if (!content.startsWith("---")) {
    return frontmatter;
  }

  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) {
    return frontmatter;
  }

  const fmContent = content.substring(3, endIndex).trim();
  const lines = fmContent.split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

function extractSuccessCriteria(content: string): string[] {
  const criteria: string[] = [];

  // Find Success Criteria section - stop at next level-2 heading
  const successMatch = content.match(/## Success Criteria[\s\S]*?(?=\n## [^#]|$)/i);
  if (!successMatch) {
    return criteria;
  }

  const section = successMatch[0];

  // Extract checkbox items
  const checkboxRegex = /- \[[ x]\] (.+)/gi;
  let match;
  while ((match = checkboxRegex.exec(section)) !== null) {
    criteria.push(match[1].trim());
  }

  return criteria;
}

function determineTShirtSize(criteriaCount: number): TShirtSize {
  if (criteriaCount <= 2) return "XS";
  if (criteriaCount <= 4) return "S";
  if (criteriaCount <= 7) return "M";
  if (criteriaCount <= 10) return "L";
  return "XL";
}

function detectDecompositionPrinciple(content: string): DecompositionPrinciple {
  const contentLower = content.toLowerCase();
  const scores: Record<DecompositionPrinciple, number> = {
    "api-first": 0,
    "domain-first": 0,
    "infrastructure-first": 0,
    "test-first": 0,
    "interface-first": 0,
  };

  for (const [principle, indicators] of Object.entries(DECOMPOSITION_PRINCIPLES)) {
    for (const keyword of indicators.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "gi");
      const matches = contentLower.match(regex);
      if (matches) {
        scores[principle as DecompositionPrinciple] += matches.length;
      }
    }
  }

  // Find highest scoring principle
  let maxScore = 0;
  let bestPrinciple: DecompositionPrinciple = "domain-first"; // default

  for (const [principle, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestPrinciple = principle as DecompositionPrinciple;
    }
  }

  return bestPrinciple;
}

function extractIntegrationPoints(content: string): string[] {
  const points: string[] = [];
  const contentLower = content.toLowerCase();

  // Look for integration-related patterns
  const patterns = [
    /integrat(?:e|ion|es|ing) (?:with )?([a-zA-Z0-9_-]+)/gi,
    /connect(?:s|ing|ion)? (?:to )?([a-zA-Z0-9_-]+)/gi,
    /depend(?:s|ency|encies) (?:on )?([a-zA-Z0-9_-]+)/gi,
    /communicate(?:s)? (?:with )?([a-zA-Z0-9_-]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const point = match[1]?.trim();
      if (point && !points.includes(point)) {
        points.push(point);
      }
    }
  }

  return points;
}

function generatePhaseStructure(
  size: TShirtSize,
  principle: DecompositionPrinciple,
  criteriaCount: number
): PhaseStructure[] {
  const thresholds = SIZE_THRESHOLDS[size];
  const pattern = DECOMPOSITION_PRINCIPLES[principle].phasePattern;

  if (!thresholds.breakdown) {
    return [];
  }

  const phases: PhaseStructure[] = [];
  const totalTasks = Math.min(
    Math.max(thresholds.subtaskRange[0], Math.ceil(criteriaCount / 2)),
    thresholds.subtaskRange[1]
  );

  // Distribute tasks across phases based on pattern
  const phaseCount = Math.min(pattern.length, Math.ceil(totalTasks / 2));
  const tasksPerPhase = Math.ceil(totalTasks / phaseCount);

  const phaseDescriptions: Record<DecompositionPrinciple, string[]> = {
    "api-first": ["Contract Definition", "Parallel Implementation", "Integration"],
    "domain-first": ["Data Model", "Service Implementation", "API Layer"],
    "infrastructure-first": ["Infrastructure Setup", "Implementation", "Deployment"],
    "test-first": ["Test Definitions", "Implementation", "Integration Tests"],
    "interface-first": ["Interface Design", "Component Implementation", "Integration"],
  };

  for (let i = 0; i < phaseCount; i++) {
    const type = pattern[i] || "parallel";
    const isLastPhase = i === phaseCount - 1;
    const phaseTasks = isLastPhase
      ? Math.max(1, totalTasks - tasksPerPhase * i)
      : Math.min(tasksPerPhase, type === "sequential" ? 1 : 4);

    phases.push({
      phase: i + 1,
      type,
      estimated_tasks: phaseTasks,
      description: phaseDescriptions[principle][i] || `Phase ${i + 1}`,
    });
  }

  return phases;
}

function generateReasoning(
  size: TShirtSize,
  principle: DecompositionPrinciple,
  criteriaCount: number,
  integrationPoints: string[]
): string {
  const thresholds = SIZE_THRESHOLDS[size];
  const principleInfo = DECOMPOSITION_PRINCIPLES[principle];

  if (!thresholds.breakdown) {
    return `Task is ${size} size (${criteriaCount} criteria) - no breakdown needed. Implementation can proceed as single task.`;
  }

  const parts = [
    `Task is ${size} size with ${criteriaCount} success criteria.`,
    `Recommended decomposition: ${principleInfo.description}.`,
    `Target ${thresholds.subtaskRange[0]}-${thresholds.subtaskRange[1]} subtasks across ${principleInfo.phasePattern.length} phases.`,
  ];

  if (thresholds.generateSpecs) {
    parts.push("Generate spec artifacts (data-model.md, contracts/, quickstart.md) for contract-first development.");
  }

  if (integrationPoints.length > 0) {
    parts.push(`Integration points identified: ${integrationPoints.join(", ")}.`);
  }

  return parts.join(" ");
}

async function analyzeParallelPhases(taskPath: string): Promise<ParallelPhaseAnalysis> {
  const result: ParallelPhaseAnalysis = {
    task_name: "",
    task_file: taskPath,
    branch: null,
    success_criteria_count: 0,
    tshirt_size: "XS",
    decomposition_principle: "domain-first",
    recommended_phases: 0,
    max_parallel_per_phase: 4,
    should_generate_specs: false,
    should_visualize: false,
    breakdown_needed: false,
    phase_structure: [],
    reasoning: "",
    integration_points: [],
  };

  // Normalize path
  let filePath = taskPath;

  if (existsSync(taskPath)) {
    const stat = statSync(taskPath);
    if (stat.isDirectory()) {
      filePath = join(taskPath, "README.md");
    }
  }

  if (!existsSync(filePath)) {
    result.error = `Task file not found: ${filePath}`;
    return result;
  }

  result.task_file = filePath;

  // Read and parse
  const content = await Bun.file(filePath).text();
  const frontmatter = parseFrontmatter(content);

  result.task_name = frontmatter.name || frontmatter.task || basename(taskPath, ".md");
  result.branch = frontmatter.branch || null;

  // Extract and analyze
  const criteria = extractSuccessCriteria(content);
  result.success_criteria_count = criteria.length;

  // Determine sizing and strategy
  result.tshirt_size = determineTShirtSize(criteria.length);
  result.decomposition_principle = detectDecompositionPrinciple(content);
  result.integration_points = extractIntegrationPoints(content);

  // Apply thresholds
  const thresholds = SIZE_THRESHOLDS[result.tshirt_size];
  result.breakdown_needed = thresholds.breakdown;
  result.should_generate_specs = thresholds.generateSpecs;
  result.should_visualize = thresholds.generateVisualization;

  // Generate phase structure
  result.phase_structure = generatePhaseStructure(
    result.tshirt_size,
    result.decomposition_principle,
    criteria.length
  );
  result.recommended_phases = result.phase_structure.length;

  // Calculate max parallel
  const parallelPhases = result.phase_structure.filter((p) => p.type === "parallel");
  result.max_parallel_per_phase = parallelPhases.length > 0
    ? Math.max(...parallelPhases.map((p) => p.estimated_tasks))
    : 0;

  // Generate reasoning
  result.reasoning = generateReasoning(
    result.tshirt_size,
    result.decomposition_principle,
    criteria.length,
    result.integration_points
  );

  return result;
}

// Main execution
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const dryRun = args.includes("--dry-run");
const taskPath = args.find((arg) => !arg.startsWith("--"));

if (!taskPath) {
  console.error("Usage: bun analyze_parallel_phases.ts <task-file-path> [--json] [--dry-run]");
  process.exit(1);
}

const analysis = await analyzeParallelPhases(taskPath);

if (dryRun) {
  console.log("[DRY RUN] Would analyze:", taskPath);
}

if (jsonOutput) {
  console.log(JSON.stringify(analysis, null, 2));
} else {
  if (analysis.error) {
    console.error(`Error: ${analysis.error}`);
    process.exit(1);
  }

  console.log(`Parallel Phase Analysis: ${analysis.task_name}`);
  console.log(`═════════════════════════════════════════════`);
  console.log(`Branch: ${analysis.branch || "(none)"}`);
  console.log(`Success Criteria: ${analysis.success_criteria_count}`);
  console.log(`T-Shirt Size: ${analysis.tshirt_size}`);
  console.log(`Decomposition: ${analysis.decomposition_principle}`);
  console.log(`Breakdown Needed: ${analysis.breakdown_needed ? "Yes" : "No"}`);

  if (analysis.breakdown_needed) {
    console.log(`\nPhase Structure:`);
    for (const phase of analysis.phase_structure) {
      const icon = phase.type === "parallel" ? "║" : "│";
      console.log(`  ${icon} Phase ${phase.phase}: ${phase.description} (${phase.type}, ~${phase.estimated_tasks} tasks)`);
    }

    console.log(`\nArtifacts:`);
    console.log(`  • Generate Specs: ${analysis.should_generate_specs ? "Yes" : "No"}`);
    console.log(`  • Generate Visualization: ${analysis.should_visualize ? "Yes" : "No"}`);
  }

  if (analysis.integration_points.length > 0) {
    console.log(`\nIntegration Points:`);
    for (const point of analysis.integration_points) {
      console.log(`  • ${point}`);
    }
  }

  console.log(`\nReasoning:`);
  console.log(`  ${analysis.reasoning}`);
}
