export interface TestFailure {
  testName: string;
  file: string;
  error: string;
  bugTaskId: string | null;
}

export interface QAResult {
  id: string;
  taskId: string;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  failures: TestFailure[];
  bugTasksCreated: string[];
  command: string;
  output: string;
  ranAt: string;
}

export function createQAResult(
  id: string,
  taskId: string,
  passed: number,
  failed: number,
  skipped: number,
  failures: TestFailure[],
  command: string,
  output: string
): QAResult {
  return {
    id,
    taskId,
    testsPassed: passed,
    testsFailed: failed,
    testsSkipped: skipped,
    failures,
    bugTasksCreated: [],
    command,
    output,
    ranAt: new Date().toISOString(),
  };
}
