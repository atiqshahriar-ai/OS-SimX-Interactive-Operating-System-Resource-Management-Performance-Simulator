"use strict";

/* =========================================================
   CPU SCHEDULER SUBSYSTEM
   ========================================================= */

class SchedulerProcess {
    constructor(process) {
        this.pid = process.pid;
        this.name = process.name;
        this.arrival = Number(process.arrival) || 0;
        this.burst = Number(process.burst) || 0;
        this.remaining = Number(process.remaining ?? process.burst) || 0;
        this.priority = Number(process.priority) || 1;

        this.startTime = null;
        this.finishTime = null;
        this.waitingTime = 0;
        this.turnaroundTime = 0;
        this.responseTime = null;
    }
}


/* =========================================================
   SCHEDULER
   ========================================================= */

class CPUScheduler {
    constructor() {
        this.algorithm = "Round Robin";
        this.quantum = 4;

        this.clock = 0;

        this.running = true;

        this.current = null;

        this.readyQueue = [];

        this.timeline = [];

        this.contextSwitches = 0;

        this.dispatchCount = 0;

        this.completed = new Set();

        this.metrics = {
            averageWaitingTime: 0,
            averageTurnaroundTime: 0,
            averageResponseTime: 0,
            throughput: 0,
            cpuUtilization: 0
        };

        this.rrIndex = 0;
        this.rrQuantumUsed = 0;

        this.history = [];
    }


    /* =====================================================
       CONFIGURATION
       ===================================================== */

    setAlgorithm(algorithm) {
        const supported = [
            "FCFS",
            "SJF",
            "SRTF",
            "Priority",
            "Round Robin"
        ];

        if (!supported.includes(algorithm)) {
            return false;
        }

        if (
            this.algorithm !== algorithm
        ) {
            this.algorithm = algorithm;

            this.rrIndex = 0;
            this.rrQuantumUsed = 0;

            this.log(
                "INFO",
                `CPU scheduling algorithm changed to ${algorithm}.`
            );
        }

        return true;
    }


    setQuantum(quantum) {
        quantum = Number(quantum);

        if (
            !Number.isInteger(quantum) ||
            quantum <= 0
        ) {
            return false;
        }

        this.quantum = quantum;
        this.rrQuantumUsed = 0;

        this.log(
            "INFO",
            `Round Robin quantum set to ${quantum}.`
        );

        return true;
    }


    /* =====================================================
       PROCESS DISCOVERY
       ===================================================== */

    getProcesses() {
        if (
            window.processManager &&
            typeof window.processManager.getAllProcesses ===
                "function"
        ) {
            return window.processManager
                .getAllProcesses()
                .filter(
                    (process) =>
                        process.state !== "Terminated"
                );
        }

        if (
            window.OS &&
            Array.isArray(window.OS.processes)
        ) {
            return window.OS.processes.filter(
                (process) =>
                    process.state !== "Terminated"
            );
        }

        return [];
    }


    getReadyProcesses() {
        return this.getProcesses()
            .filter(
                (process) =>
                    process.remaining > 0 &&
                    (
                        process.state === "Ready" ||
                        process.state === "Running"
                    )
            );
    }


    /* =====================================================
       MAIN CLOCK TICK
       ===================================================== */

    tick() {
        if (!this.running) {
            return;
        }

        this.updateReadyQueue();

        const next =
            this.selectNextProcess();

        if (
            !next
        ) {
            this.recordIdleTick();

            this.clock++;

            this.updateMetrics();

            this.syncLegacyState();

            return;
        }


        const nextPid =
            Number(next.pid);


        if (
            this.current === null
        ) {
            this.dispatch(nextPid);
        } else if (
            this.current !== nextPid
        ) {
            this.contextSwitch(
                this.current,
                nextPid
            );
        }


        const process =
            this.getProcess(
                this.current
            );


        if (!process) {
            this.current = null;
            this.clock++;
            return;
        }


        this.executeOneCycle(
            process
        );


        this.clock++;


        if (
            this.algorithm ===
            "Round Robin"
        ) {
            this.rrQuantumUsed++;

            if (
                process.remaining <= 0
            ) {
                this.rrQuantumUsed = 0;
            } else if (
                this.rrQuantumUsed >=
                this.quantum
            ) {
                this.rrQuantumUsed = 0;

                process.ready();

                this.current = null;

                this.log(
                    "INFO",
                    `Time quantum expired for PID ${process.pid}.`
                );
            }
        }


        this.updateReadyQueue();

        this.updateWaitingTimes();

        this.updateMetrics();

        this.syncLegacyState();

        this.render();
    }


    /* =====================================================
       PROCESS SELECTION
       ===================================================== */

    selectNextProcess() {
        const processes =
            this.getReadyProcesses();

        if (!processes.length) {
            return null;
        }


        switch (this.algorithm) {

            case "FCFS":
                return this.selectFCFS(
                    processes
                );


            case "SJF":
                return this.selectSJF(
                    processes
                );


            case "SRTF":
                return this.selectSRTF(
                    processes
                );


            case "Priority":
                return this.selectPriority(
                    processes
                );


            case "Round Robin":
            default:
                return this.selectRoundRobin(
                    processes
                );
        }
    }


    /* =====================================================
       FCFS
       ===================================================== */

    selectFCFS(processes) {
        if (
            this.current !== null
        ) {
            const current =
                processes.find(
                    (p) =>
                        p.pid ===
                        this.current
                );

            if (current) {
                return current;
            }
        }

        return [...processes].sort(
            (a, b) =>
                a.arrival - b.arrival ||
                a.pid - b.pid
        )[0];
    }


    /* =====================================================
       SJF
       ===================================================== */

    selectSJF(processes) {
        if (
            this.current !== null
        ) {
            const current =
                processes.find(
                    (p) =>
                        p.pid ===
                        this.current
                );

            if (current) {
                return current;
            }
        }

        return [...processes].sort(
            (a, b) =>
                a.burst - b.burst ||
                a.arrival - b.arrival ||
                a.pid - b.pid
        )[0];
    }


    /* =====================================================
       SRTF
       ===================================================== */

    selectSRTF(processes) {
        return [...processes].sort(
            (a, b) =>
                a.remaining - b.remaining ||
                a.arrival - b.arrival ||
                a.pid - b.pid
        )[0];
    }


    /* =====================================================
       PRIORITY
       ===================================================== */

    selectPriority(processes) {
        if (
            this.current !== null
        ) {
            const current =
                processes.find(
                    (p) =>
                        p.pid ===
                        this.current
                );

            if (current) {
                const best =
                    [...processes].sort(
                        (a, b) =>
                            a.priority -
                                b.priority ||
                            a.arrival -
                                b.arrival
                    )[0];

                if (
                    best.priority >=
                    current.priority
                ) {
                    return current;
                }
            }
        }

        return [...processes].sort(
            (a, b) =>
                a.priority - b.priority ||
                a.arrival - b.arrival ||
                a.pid - b.pid
        )[0];
    }


    /* =====================================================
       ROUND ROBIN
       ===================================================== */

    selectRoundRobin(processes) {
        if (
            this.current !== null
        ) {
            const current =
                processes.find(
                    (p) =>
                        p.pid ===
                        this.current
                );

            if (
                current &&
                this.rrQuantumUsed <
                    this.quantum
            ) {
                return current;
            }
        }


        const sorted =
            [...processes].sort(
                (a, b) =>
                    a.arrival - b.arrival ||
                    a.pid - b.pid
            );


        if (
            !sorted.length
        ) {
            return null;
        }


        this.rrIndex =
            this.rrIndex %
            sorted.length;


        const selected =
            sorted[this.rrIndex];


        this.rrIndex =
            (
                this.rrIndex + 1
            ) %
            sorted.length;


        return selected;
    }


    /* =====================================================
       DISPATCH
       ===================================================== */

    dispatch(pid) {
        const process =
            this.getProcess(pid);

        if (!process) {
            return false;
        }


        if (
            this.current !== null &&
            this.current !== pid
        ) {
            const old =
                this.getProcess(
                    this.current
                );

            if (
                old &&
                old.state === "Running"
            ) {
                old.ready();
            }

            this.contextSwitches++;
        }


        process.state =
            "Running";


        if (
            process.startTime === null
        ) {
            process.startTime =
                this.clock;

            process.responseTime =
                this.clock -
                Number(process.arrival);
        }


        this.current =
            Number(pid);

        this.dispatchCount++;


        this.log(
            "INFO",
            `Dispatcher selected PID ${pid} (${process.name}).`
        );


        return true;
    }


    /* =====================================================
       CONTEXT SWITCH
       ===================================================== */

    contextSwitch(
        fromPid,
        toPid
    ) {
        const from =
            this.getProcess(
                fromPid
            );

        const to =
            this.getProcess(
                toPid
            );


        if (
            from &&
            from.state ===
                "Running"
        ) {
            from.ready();
        }


        if (!to) {
            this.current = null;
            return;
        }


        to.state =
            "Running";


        if (
            to.startTime === null
        ) {
            to.startTime =
                this.clock;

            to.responseTime =
                this.clock -
                Number(to.arrival);
        }


        this.current =
            Number(toPid);


        this.contextSwitches++;


        this.log(
            "INFO",
            `Context switch ${fromPid} → ${toPid}.`
        );
    }


    /* =====================================================
       EXECUTION
       ===================================================== */

    executeOneCycle(process) {
        const before =
            Number(
                process.remaining
            );


        if (
            before <= 0
        ) {
            return;
        }


        if (
            typeof process.execute ===
            "function"
        ) {
            process.execute(1);
        } else {
            process.remaining--;
        }


        const after =
            Number(
                process.remaining
            );


        const executed =
            before - after;


        if (
            executed <= 0
        ) {
            return;
        }


        this.addTimelineEntry(
            process.pid,
            this.clock,
            this.clock + executed
        );


        if (
            process.remaining <= 0
        ) {
            process.remaining = 0;

            process.state =
                "Terminated";


            process.finishTime =
                this.clock + 1;


            process.turnaroundTime =
                process.finishTime -
                Number(process.arrival);


            this.completed.add(
                process.pid
            );


            this.log(
                "SUCCESS",
                `PID ${process.pid} completed at time ${this.clock + 1}.`
            );


            this.current =
                null;


            this.rrQuantumUsed = 0;
        }
    }


    /* =====================================================
       TIMELINE / GANTT
       ===================================================== */

    addTimelineEntry(
        pid,
        start,
        end
    ) {
        const last =
            this.timeline[
                this.timeline.length - 1
            ];


        if (
            last &&
            last.pid === pid &&
            last.end === start
        ) {
            last.end = end;
            return;
        }


        this.timeline.push({
            pid,
            start,
            end
        });
    }


    recordIdleTick() {
        const last =
            this.timeline[
                this.timeline.length - 1
            ];


        if (
            last &&
            last.pid === "IDLE" &&
            last.end === this.clock
        ) {
            last.end++;
            return;
        }


        this.timeline.push({
            pid: "IDLE",
            start: this.clock,
            end: this.clock + 1
        });
    }


    /* =====================================================
       READY QUEUE
       ===================================================== */

    updateReadyQueue() {
        this.readyQueue =
            this.getReadyProcesses()
                .filter(
                    (process) =>
                        process.pid !==
                        this.current
                )
                .map(
                    (process) =>
                        Number(process.pid)
                );
    }


    /* =====================================================
       WAITING TIME
       ===================================================== */

    updateWaitingTimes() {
        this.getProcesses().forEach(
            (process) => {

                if (
                    process.state ===
                        "Ready" &&
                    process.pid !==
                        this.current
                ) {
                    process.waitingTime =
                        Number(
                            process.waitingTime ||
                            0
                        ) + 1;
                }

            }
        );
    }


    /* =====================================================
       METRICS
       ===================================================== */

    updateMetrics() {
        const all =
            this.getAllKnownProcesses();


        const completed =
            all.filter(
                (process) =>
                    process.state ===
                    "Terminated" &&
                    process.finishTime !==
                        null
            );


        if (
            completed.length
        ) {
            this.metrics.averageWaitingTime =
                completed.reduce(
                    (sum, process) =>
                        sum +
                        Number(
                            process.waitingTime ||
                            0
                        ),
                    0
                ) /
                completed.length;


            this.metrics.averageTurnaroundTime =
                completed.reduce(
                    (sum, process) =>
                        sum +
                        Number(
                            process.turnaroundTime ||
                            0
                        ),
                    0
                ) /
                completed.length;


            const responseTimes =
                completed.filter(
                    (process) =>
                        process.responseTime !==
                        null
                );


            this.metrics.averageResponseTime =
                responseTimes.length
                    ? responseTimes.reduce(
                          (
                              sum,
                              process
                          ) =>
                              sum +
                              Number(
                                  process.responseTime
                              ),
                          0
                      ) /
                      responseTimes.length
                    : 0;


            this.metrics.throughput =
                completed.length /
                Math.max(
                    1,
                    this.clock
                );
        }


        const busyTime =
            this.timeline
                .filter(
                    (entry) =>
                        entry.pid !==
                        "IDLE"
                )
                .reduce(
                    (sum, entry) =>
                        sum +
                        (
                            entry.end -
                            entry.start
                        ),
                    0
                );


        this.metrics.cpuUtilization =
            this.clock > 0
                ? (
                      busyTime /
                      this.clock
                  ) *
                  100
                : 0;
    }


    /* =====================================================
       ALL PROCESSES
       ===================================================== */

    getAllKnownProcesses() {
        if (
            window.processManager &&
            typeof window.processManager
                .getAllProcesses ===
                "function"
        ) {
            return window.processManager
                .getAllProcesses();
        }


        if (
            window.OS &&
            Array.isArray(
                window.OS.processes
            )
        ) {
            return window.OS.processes;
        }


        return [];
    }


    getProcess(pid) {
        if (
            window.processManager &&
            typeof window.processManager
                .getProcess ===
                "function"
        ) {
            return window.processManager
                .getProcess(pid);
        }


        if (
            window.OS &&
            Array.isArray(
                window.OS.processes
            )
        ) {
            return window.OS.processes.find(
                (process) =>
                    Number(process.pid) ===
                    Number(pid)
            );
        }


        return null;
    }


    /* =====================================================
       RESET
       ===================================================== */

    reset() {
        this.clock = 0;
        this.current = null;

        this.readyQueue = [];

        this.timeline = [];

        this.contextSwitches = 0;

        this.dispatchCount = 0;

        this.completed.clear();

        this.rrIndex = 0;
        this.rrQuantumUsed = 0;

        this.metrics = {
            averageWaitingTime: 0,
            averageTurnaroundTime: 0,
            averageResponseTime: 0,
            throughput: 0,
            cpuUtilization: 0
        };

        this.history = [];
    }


    /* =====================================================
       RUN / PAUSE
       ===================================================== */

    start() {
        this.running = true;

        this.log(
            "INFO",
            "CPU scheduler started."
        );
    }


    pause() {
        this.running = false;

        this.log(
            "WARNING",
            "CPU scheduler paused."
        );
    }


    toggle() {
        if (this.running) {
            this.pause();
        } else {
            this.start();
        }

        return this.running;
    }


    /* =====================================================
       SIMULATION
       ===================================================== */

    runSimulation(maxTicks = 500) {
        let ticks = 0;


        while (
            ticks < maxTicks
        ) {
            const active =
                this.getReadyProcesses();


            if (
                !active.length &&
                this.current === null
            ) {
                break;
            }


            this.tick();

            ticks++;
        }


        this.updateMetrics();


        return {
            algorithm:
                this.algorithm,

            ticks,

            timeline:
                [...this.timeline],

            metrics:
                {
                    ...this.metrics
                }
        };
    }


    /* =====================================================
       COMPARISON ENGINE
       ===================================================== */

    compareAlgorithms() {
        const algorithms = [
            "FCFS",
            "SJF",
            "SRTF",
            "Priority",
            "Round Robin"
        ];


        const processes =
            this.getAllKnownProcesses()
                .map(
                    (process) => ({
                        pid:
                            Number(
                                process.pid
                            ),

                        arrival:
                            Number(
                                process.arrival
                            ),

                        burst:
                            Number(
                                process.burst
                            ),

                        priority:
                            Number(
                                process.priority
                            )
                    })
                )
                .filter(
                    (process) =>
                        process.burst > 0
                );


        return algorithms.map(
            (algorithm) =>
                this.simulateDataset(
                    algorithm,
                    processes
                )
        );
    }


    simulateDataset(
        algorithm,
        dataset
    ) {
        const processes =
            dataset.map(
                (process) =>
                    new SchedulerProcess(
                        process
                    )
            );


        let time = 0;

        let current = null;

        let quantumUsed = 0;

        let rrIndex = 0;

        const timeline = [];


        const completed =
            [];


        const getReady = () =>
            processes.filter(
                (process) =>
                    process.remaining >
                        0 &&
                    process.arrival <=
                        time
            );


        const select = () => {
            const ready =
                getReady();


            if (!ready.length) {
                return null;
            }


            switch (
                algorithm
            ) {
                case "FCFS":
                    return [...ready].sort(
                        (a, b) =>
                            a.arrival -
                                b.arrival ||
                            a.pid -
                                b.pid
                    )[0];


                case "SJF":
                    return [...ready].sort(
                        (a, b) =>
                            a.burst -
                                b.burst ||
                            a.arrival -
                                b.arrival
                    )[0];


                case "SRTF":
                    return [...ready].sort(
                        (a, b) =>
                            a.remaining -
                                b.remaining ||
                            a.arrival -
                                b.arrival
                    )[0];


                case "Priority":
                    return [...ready].sort(
                        (a, b) =>
                            a.priority -
                                b.priority ||
                            a.arrival -
                                b.arrival
                    )[0];


                case "Round Robin": {
                    const sorted =
                        [...ready].sort(
                            (a, b) =>
                                a.arrival -
                                    b.arrival ||
                                a.pid -
                                    b.pid
                        );


                    if (
                        current &&
                        current.remaining >
                            0 &&
                        quantumUsed <
                            this.quantum
                    ) {
                        return current;
                    }


                    if (
                        rrIndex >=
                        sorted.length
                    ) {
                        rrIndex = 0;
                    }


                    return (
                        sorted[
                            rrIndex++
                        ] ||
                        sorted[0]
                    );
                }


                default:
                    return ready[0];
            }
        };


        let safety = 0;


        while (
            completed.length <
                processes.length &&
            safety < 10000
        ) {
            safety++;


            const selected =
                select();


            if (!selected) {
                time++;

                current = null;

                quantumUsed = 0;

                continue;
            }


            if (
                current !== selected
            ) {
                current =
                    selected;

                quantumUsed = 0;


                if (
                    current.startTime ===
                    null
                ) {
                    current.startTime =
                        time;

                    current.responseTime =
                        time -
                        current.arrival;
                }
            }


            current.remaining--;

            quantumUsed++;


            const last =
                timeline[
                    timeline.length -
                        1
                ];


            if (
                last &&
                last.pid ===
                    current.pid &&
                last.end === time
            ) {
                last.end++;
            } else {
                timeline.push({
                    pid:
                        current.pid,
                    start:
                        time,
                    end:
                        time + 1
                });
            }


            time++;


            processes.forEach(
                (process) => {
                    if (
                        process !==
                            current &&
                        process.remaining >
                            0 &&
                        process.arrival <=
                            time
                    ) {
                        process.waitingTime++;
                    }
                }
            );


            if (
                current.remaining <=
                0
            ) {
                current.remaining = 0;

                current.finishTime =
                    time;

                current.turnaroundTime =
                    current.finishTime -
                    current.arrival;

                completed.push(
                    current
                );

                current = null;

                quantumUsed = 0;
            } else if (
                algorithm ===
                    "Round Robin" &&
                quantumUsed >=
                    this.quantum
            ) {
                current = null;
                quantumUsed = 0;
            }
        }


        const avgWaiting =
            completed.length
                ? completed.reduce(
                      (
                          sum,
                          process
                      ) =>
                          sum +
                          process.waitingTime,
                      0
                  ) /
                  completed.length
                : 0;


        const avgTurnaround =
            completed.length
                ? completed.reduce(
                      (
                          sum,
                          process
                      ) =>
                          sum +
                          process.turnaroundTime,
                      0
                  ) /
                  completed.length
                : 0;


        const avgResponse =
            completed.length
                ? completed.reduce(
                      (
                          sum,
                          process
                      ) =>
                          sum +
                          (
                              process.responseTime ||
                              0
                          ),
                      0
                  ) /
                  completed.length
                : 0;


        return {
            algorithm,

            averageWaitingTime:
                Number(
                    avgWaiting.toFixed(
                        2
                    )
                ),

            averageTurnaroundTime:
                Number(
                    avgTurnaround.toFixed(
                        2
                    )
                ),

            averageResponseTime:
                Number(
                    avgResponse.toFixed(
                        2
                    )
                ),

            throughput:
                Number(
                    (
                        completed.length /
                        Math.max(
                            1,
                            time
                        )
                    ).toFixed(4)
                ),

            timeline
        };
    }


    /* =====================================================
       LEGACY STATE
       ===================================================== */

    syncLegacyState() {
        if (!window.OS) {
            return;
        }


        if (
            window.OS.scheduler
        ) {
            window.OS.scheduler.clock =
                this.clock;

            window.OS.scheduler.algorithm =
                this.algorithm;

            window.OS.scheduler.quantum =
                this.quantum;

            window.OS.scheduler.running =
                this.running;

            window.OS.scheduler.timeline =
                [...this.timeline];
        }


        window.OS.currentProcess =
            this.current;
    }


    /* =====================================================
       LOG
       ===================================================== */

    log(level, message) {
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


    /* =====================================================
       RENDER BRIDGE
       ===================================================== */

    render() {
        if (
            typeof window.renderScheduler ===
            "function"
        ) {
            window.renderScheduler();
        }

        if (
            typeof window.renderProcesses ===
            "function"
        ) {
            window.renderProcesses();
        }

        if (
            typeof window.renderDashboard ===
            "function"
        ) {
            window.renderDashboard();
        }
    }
}


/* =========================================================
   GLOBAL INSTANCE
   ========================================================= */

window.cpuScheduler =
    new CPUScheduler();


/* =========================================================
   SCHEDULER API
   ========================================================= */

window.SchedulerAPI = {

    start() {
        window.cpuScheduler.start();
    },


    pause() {
        window.cpuScheduler.pause();
    },


    toggle() {
        return window.cpuScheduler.toggle();
    },


    tick() {
        window.cpuScheduler.tick();
    },


    algorithm(name) {
        return window.cpuScheduler.setAlgorithm(
            name
        );
    },


    quantum(value) {
        return window.cpuScheduler.setQuantum(
            value
        );
    },


    run(ticks = 100) {
        return window.cpuScheduler.runSimulation(
            ticks
        );
    },


    compare() {
        return window.cpuScheduler.compareAlgorithms();
    },


    metrics() {
        return {
            ...window.cpuScheduler.metrics
        };
    },


    timeline() {
        return [
            ...window.cpuScheduler.timeline
        ];
    },


    reset() {
        window.cpuScheduler.reset();
    }
};


/* =========================================================
   BRIDGE EXISTING app.js SCHEDULER
   ========================================================= */

const originalSchedulerTick =
    window.schedulerTick;


window.schedulerTick =
    function () {
        if (
            window.cpuScheduler
        ) {
            window.cpuScheduler.tick();
            return;
        }


        if (
            typeof originalSchedulerTick ===
            "function"
        ) {
            originalSchedulerTick();
        }
    };


/* =========================================================
   BRIDGE ALGORITHM BUTTONS
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {
        document
            .querySelectorAll(
                ".algorithm-btn"
            )
            .forEach(
                (button) => {
                    button.addEventListener(
                        "click",
                        () => {
                            const algorithm =
                                button.dataset
                                    .algorithm;

                            if (
                                algorithm
                            ) {
                                window.cpuScheduler
                                    .setAlgorithm(
                                        algorithm
                                    );
                            }
                        }
                    );
                }
            );
    }
);