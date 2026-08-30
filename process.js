"use strict";

/* =========================================================
   PROCESS CONTROL BLOCK (PCB)
   ========================================================= */

class ProcessControlBlock {
    constructor({
        pid,
        name,
        priority = 1,
        arrival = 0,
        burst = 10,
        memory = 8,
        owner = "user"
    }) {
        this.pid = pid;
        this.name = name;
        this.state = "New";

        this.priority = priority;
        this.arrival = arrival;
        this.burst = burst;
        this.remaining = burst;

        this.memory = memory;
        this.owner = owner;

        this.programCounter = 0;
        this.registers = {
            AX: 0,
            BX: 0,
            CX: 0,
            DX: 0
        };

        this.contextSwitches = 0;
        this.waitingTime = 0;
        this.turnaroundTime = 0;
        this.startTime = null;
        this.finishTime = null;

        this.createdAt = Date.now();
    }

    dispatch(time) {
        if (this.state === "Terminated") {
            return false;
        }

        if (this.startTime === null) {
            this.startTime = time;
        }

        this.state = "Running";
        this.contextSwitches++;

        return true;
    }

    execute(cycles = 1) {
        if (
            this.state !== "Running" ||
            this.remaining <= 0
        ) {
            return false;
        }

        const actualCycles =
            Math.min(cycles, this.remaining);

        this.remaining -= actualCycles;
        this.programCounter += actualCycles;

        this.registers.AX =
            (this.registers.AX + actualCycles) % 256;

        this.registers.BX =
            (this.registers.BX + this.pid) % 256;

        if (this.remaining <= 0) {
            this.remaining = 0;
        }

        return true;
    }

    block() {
        if (this.state === "Terminated") {
            return false;
        }

        this.state = "Blocked";
        return true;
    }

    ready() {
        if (this.state === "Terminated") {
            return false;
        }

        this.state = "Ready";
        return true;
    }

    terminate(time) {
        if (
            this.state === "Terminated"
        ) {
            return false;
        }

        this.remaining = 0;
        this.state = "Terminated";
        this.finishTime = time;

        if (this.startTime !== null) {
            this.turnaroundTime =
                time - this.arrival;
        }

        return true;
    }

    snapshot() {
        return {
            pid: this.pid,
            name: this.name,
            state: this.state,
            priority: this.priority,
            arrival: this.arrival,
            burst: this.burst,
            remaining: this.remaining,
            memory: this.memory,
            owner: this.owner,
            programCounter: this.programCounter,
            registers: {
                ...this.registers
            },
            contextSwitches: this.contextSwitches,
            waitingTime: this.waitingTime,
            turnaroundTime: this.turnaroundTime
        };
    }
}


/* =========================================================
   PROCESS TABLE
   ========================================================= */

class ProcessManager {
    constructor() {
        this.table = new Map();
        this.nextPid = 1;
        this.currentPid = null;
    }

    createProcess(options = {}) {
        const pid =
            options.pid ??
            this.nextPid++;

        if (this.table.has(pid)) {
            throw new Error(
                `PID ${pid} already exists.`
            );
        }

        const pcb =
            new ProcessControlBlock({
                pid,
                name:
                    options.name ||
                    `process-${pid}`,
                priority:
                    options.priority ?? 1,
                arrival:
                    options.arrival ??
                    this.getSystemTime(),
                burst:
                    options.burst ?? 10,
                memory:
                    options.memory ?? 8,
                owner:
                    options.owner || "user"
            });

        pcb.state = "Ready";

        this.table.set(
            pid,
            pcb
        );

        if (
            window.OS &&
            typeof window.OS.processCounter ===
                "number"
        ) {
            window.OS.processCounter =
                Math.max(
                    window.OS.processCounter,
                    pid
                );
        }

        this.log(
            "INFO",
            `PCB created for PID ${pid} (${pcb.name}).`
        );

        return pcb;
    }

    getProcess(pid) {
        return this.table.get(
            Number(pid)
        );
    }

    removeProcess(pid) {
        return this.table.delete(
            Number(pid)
        );
    }

    getAllProcesses() {
        return [...this.table.values()];
    }

    getReadyQueue() {
        return this.getAllProcesses()
            .filter(
                (process) =>
                    process.state === "Ready"
            )
            .sort(
                (a, b) =>
                    a.arrival - b.arrival ||
                    a.pid - b.pid
            );
    }

    getBlockedProcesses() {
        return this.getAllProcesses()
            .filter(
                (process) =>
                    process.state === "Blocked"
            );
    }

    getRunningProcess() {
        if (this.currentPid === null) {
            return null;
        }

        return this.getProcess(
            this.currentPid
        );
    }

    dispatch(pid) {
        const process =
            this.getProcess(pid);

        if (!process) {
            return false;
        }

        const current =
            this.getRunningProcess();

        if (
            current &&
            current.pid !== process.pid &&
            current.state === "Running"
        ) {
            current.ready();
        }

        process.dispatch(
            this.getSystemTime()
        );

        this.currentPid =
            process.pid;

        this.syncLegacyState();

        this.log(
            "INFO",
            `Dispatcher selected PID ${process.pid}.`
        );

        return true;
    }

    block(pid) {
        const process =
            this.getProcess(pid);

        if (!process) {
            return false;
        }

        process.block();

        if (
            this.currentPid === process.pid
        ) {
            this.currentPid = null;
        }

        this.syncLegacyState();

        this.log(
            "INFO",
            `PID ${pid} moved to BLOCKED state.`
        );

        return true;
    }

    ready(pid) {
        const process =
            this.getProcess(pid);

        if (!process) {
            return false;
        }

        process.ready();

        this.syncLegacyState();

        this.log(
            "INFO",
            `PID ${pid} moved to READY state.`
        );

        return true;
    }

    terminate(pid) {
        const process =
            this.getProcess(pid);

        if (!process) {
            return false;
        }

        if (
            process.name === "init" ||
            process.name === "kernel"
        ) {
            this.log(
                "WARNING",
                `Refused termination of protected process PID ${pid}.`
            );

            return false;
        }

        process.terminate(
            this.getSystemTime()
        );

        if (
            this.currentPid === process.pid
        ) {
            this.currentPid = null;
        }

        this.syncLegacyState();

        this.log(
            "WARNING",
            `PID ${pid} terminated.`
        );

        return true;
    }

    executeCurrent(cycles = 1) {
        const process =
            this.getRunningProcess();

        if (!process) {
            return null;
        }

        process.execute(cycles);

        if (process.remaining <= 0) {
            process.terminate(
                this.getSystemTime()
            );

            this.currentPid = null;

            this.log(
                "SUCCESS",
                `PID ${process.pid} completed execution.`
            );
        }

        this.syncLegacyState();

        return process;
    }

    updateWaitingTimes() {
        const runningPid =
            this.currentPid;

        this.getAllProcesses().forEach(
            (process) => {
                if (
                    process.state === "Ready" &&
                    process.pid !== runningPid
                ) {
                    process.waitingTime++;
                }
            }
        );
    }

    contextSwitch(fromPid, toPid) {
        const from =
            this.getProcess(fromPid);

        const to =
            this.getProcess(toPid);

        if (from && from.state === "Running") {
            from.ready();
        }

        if (to) {
            to.dispatch(
                this.getSystemTime()
            );
        }

        this.currentPid =
            to ? to.pid : null;

        this.syncLegacyState();

        this.log(
            "INFO",
            `Context switch: ${
                fromPid ?? "IDLE"
            } → ${
                toPid ?? "IDLE"
            }`
        );
    }

    getSystemTime() {
        if (
            window.OS &&
            window.OS.scheduler
        ) {
            return window.OS.scheduler.clock;
        }

        return 0;
    }

    syncLegacyState() {
        if (!window.OS) {
            return;
        }

        window.OS.currentProcess =
            this.currentPid;

        window.OS.processes =
            this.getAllProcesses().map(
                (process) =>
                    process.snapshot()
            );
    }

    log(level, message) {
        if (
            window.OS &&
            typeof window.OS.logs !==
                "undefined"
        ) {
            if (
                typeof window.addLog ===
                "function"
            ) {
                window.addLog(
                    level,
                    message
                );
            }
        }
    }
}


/* =========================================================
   PROCESS MANAGER INSTANCE
   ========================================================= */

window.processManager =
    new ProcessManager();


/* =========================================================
   IMPORT EXISTING OS PROCESSES
   ========================================================= */

function initializeProcessManager() {
    if (
        !window.OS ||
        !Array.isArray(
            window.OS.processes
        )
    ) {
        return;
    }

    window.OS.processes.forEach(
        (process) => {
            if (
                window.processManager.table.has(
                    process.pid
                )
            ) {
                return;
            }

            const pcb =
                new ProcessControlBlock({
                    pid: process.pid,
                    name: process.name,
                    priority:
                        process.priority,
                    arrival:
                        process.arrival,
                    burst:
                        process.burst,
                    memory:
                        process.memory,
                    owner:
                        process.owner
                });

            pcb.state =
                process.state;

            pcb.remaining =
                process.remaining;

            window.processManager.table.set(
                pcb.pid,
                pcb
            );

            window.processManager.nextPid =
                Math.max(
                    window.processManager.nextPid,
                    pcb.pid + 1
                );
        }
    );

    window.processManager.currentPid =
        window.OS.currentProcess;

    window.processManager.syncLegacyState();
}


/* =========================================================
   SAFE API
   ========================================================= */

window.ProcessAPI = {
    create(options) {
        return window.processManager
            .createProcess(options);
    },

    get(pid) {
        return window.processManager
            .getProcess(pid);
    },

    list() {
        return window.processManager
            .getAllProcesses();
    },

    ready(pid) {
        return window.processManager
            .ready(pid);
    },

    block(pid) {
        return window.processManager
            .block(pid);
    },

    terminate(pid) {
        return window.processManager
            .terminate(pid);
    },

    dispatch(pid) {
        return window.processManager
            .dispatch(pid);
    },

    execute(cycles = 1) {
        return window.processManager
            .executeCurrent(cycles);
    }
};


/* =========================================================
   STARTUP
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        initializeProcessManager,
        {
            once: true
        }
    );
} else {
    initializeProcessManager();
}