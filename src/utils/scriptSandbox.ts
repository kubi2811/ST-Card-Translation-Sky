/**
 * ─── P4 Roadmap Trợ Lý AI — Script sandbox (QuickJS-WASM) ───
 * Thực thi JS do AI sinh trong INTERPRETER TÁCH BIỆT HOÀN TOÀN (quickjs-emscripten):
 * - KHÔNG fetch/XHR/WebSocket (iframe allow-scripts cũ vẫn gọi mạng được — lỗ hổng đã vá),
 * - KHÔNG DOM, KHÔNG localStorage/IndexedDB, KHÔNG đụng được app,
 * - giới hạn CPU (interrupt theo deadline) + RAM,
 * - dữ liệu vào là BẢN SAO JSON (sandbox sửa gì cũng không lan ra ngoài).
 */

export interface SandboxResult {
  ok: boolean;
  /** console.log gom lại + giá trị biểu thức cuối (nếu có). */
  output: string;
  error?: string;
  durationMs: number;
}

let quickJsPromise: Promise<any> | null = null;
function getQuickJsLazy(): Promise<any> {
  if (!quickJsPromise) {
    quickJsPromise = import('quickjs-emscripten').then(m => m.getQuickJS());
  }
  return quickJsPromise;
}

export interface SandboxOptions {
  /** Deadline CPU — quá là interrupt (mặc định 5s). */
  timeoutMs?: number;
  /** Giới hạn RAM interpreter (mặc định 64MB). */
  memoryBytes?: number;
  /** Dữ liệu chỉ-đọc đưa vào global `input` (được JSON-clone — sandbox không sửa được bản gốc). */
  input?: unknown;
}

export async function runInSandbox(code: string, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const started = Date.now();
  try {
    const QuickJS = await getQuickJsLazy();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(opts.memoryBytes ?? 64 * 1024 * 1024);
    // Interrupt theo deadline — chặn while(1) đốt CPU
    const deadline = Date.now() + timeoutMs;
    runtime.setInterruptHandler(() => Date.now() > deadline);

    const vm = runtime.newContext();
    const logs: string[] = [];
    try {
      // console.log/error gom output ra ngoài
      const logFn = vm.newFunction('log', (...args: any[]) => {
        logs.push(args.map((a: any) => {
          const v = vm.dump(a);
          return typeof v === 'string' ? v : JSON.stringify(v);
        }).join(' '));
      });
      const consoleObj = vm.newObject();
      vm.setProp(consoleObj, 'log', logFn);
      vm.setProp(consoleObj, 'error', logFn);
      vm.setProp(vm.global, 'console', consoleObj);
      consoleObj.dispose();
      logFn.dispose();

      // input = bản SAO JSON (không phải tham chiếu) — sandbox không đụng được dữ liệu thật
      if (opts.input !== undefined) {
        const inputHandle = vm.evalCode(`(${JSON.stringify(JSON.stringify(opts.input))})`);
        const parsed = vm.unwrapResult(inputHandle);
        const jsonObj = vm.getProp(vm.global, 'JSON');
        const parseFn = vm.getProp(jsonObj, 'parse');
        const inputVal = vm.unwrapResult(vm.callFunction(parseFn, jsonObj, parsed));
        vm.setProp(vm.global, 'input', inputVal);
        inputVal.dispose(); parseFn.dispose(); jsonObj.dispose(); parsed.dispose();
      }

      const result = vm.evalCode(code);
      if (result.error) {
        const err = vm.dump(result.error);
        result.error.dispose();
        const msg = typeof err === 'object' && err ? `${(err as any).name || 'Error'}: ${(err as any).message || JSON.stringify(err)}` : String(err);
        return { ok: false, output: logs.join('\n'), error: msg, durationMs: Date.now() - started };
      }
      const value = vm.dump(result.value);
      result.value.dispose();
      if (value !== undefined && value !== null) {
        logs.push(typeof value === 'string' ? value : JSON.stringify(value));
      }
      return { ok: true, output: logs.join('\n') || '(không có output)', durationMs: Date.now() - started };
    } finally {
      vm.dispose();
      runtime.dispose();
    }
  } catch (e: any) {
    return { ok: false, output: '', error: e?.message || String(e), durationMs: Date.now() - started };
  }
}
