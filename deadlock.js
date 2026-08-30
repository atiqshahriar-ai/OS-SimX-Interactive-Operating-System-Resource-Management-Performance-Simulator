"use strict";

/*
 * ============================================================
 * OS-SimX — DEADLOCK & SYNCHRONIZATION SUBSYSTEM
 * ============================================================
 *
 * Implements:
 *   1. Resource allocation
 *   2. Resource request/release
 *   3. Banker's safety algorithm
 *   4. Deadlock detection
 *   5. Resource Allocation Graph
 *   6. Wait-for graph
 *   7. Binary / counting semaphores
 *
 * This subsystem is intentionally independent from the UI.
 * app.js can consume the public DeadlockAPI exposed at the end.
 * ============================================================
 */


/* ============================================================
   RESOURCE
   ============================================================ */

class OSResource {

    constructor(
        id,
        name,
        instances = 1
    ) {

        this.id =
            String(id);

        this.name =
            String(name || id);

        this.instances =
            Math.max(
                1,
                Number(instances) || 1
            );

        this.available =
            this.instances;
    }


    reset() {

        this.available =
            this.instances;
    }


    snapshot() {

        return {
            id:
                this.id,

            name:
                this.name,

            instances:
                this.instances,

            available:
                this.available,

            allocated:
                this.instances -
                this.available
        };
    }
}


/* ============================================================
   PROCESS RESOURCE STATE
   ============================================================ */

class ResourceProcessState {

    constructor(
        pid
    ) {

        this.pid =
            Number(pid);

        this.allocation =
            new Map();

        this.maximum =
            new Map();

        this.need =
            new Map();
    }


    setMaximum(
        resourceId,
        amount
    ) {

        amount =
            Math.max(
                0,
                Number(amount) || 0
            );

        this.maximum.set(
            resourceId,
            amount
        );

        this.recalculateNeed(
            resourceId
        );
    }


    setAllocation(
        resourceId,
        amount
    ) {

        amount =
            Math.max(
                0,
                Number(amount) || 0
            );

        this.allocation.set(
            resourceId,
            amount
        );

        this.recalculateNeed(
            resourceId
        );
    }


    recalculateNeed(
        resourceId
    ) {

        const max =
            this.maximum.get(
                resourceId
            ) || 0;

        const allocated =
            this.allocation.get(
                resourceId
            ) || 0;

        this.need.set(
            resourceId,
            Math.max(
                0,
                max - allocated
            )
        );
    }


    getNeed(
        resourceId
    ) {

        return (
            this.need.get(
                resourceId
            ) || 0
        );
    }


    getAllocation(
        resourceId
    ) {

        return (
            this.allocation.get(
                resourceId
            ) || 0
        );
    }


    getMaximum(
        resourceId
    ) {

        return (
            this.maximum.get(
                resourceId
            ) || 0
        );
    }


    snapshot(
        resourceIds
    ) {

        const allocation = {};
        const maximum = {};
        const need = {};


        resourceIds.forEach(
            resourceId => {

                allocation[
                    resourceId
                ] =
                    this.getAllocation(
                        resourceId
                    );

                maximum[
                    resourceId
                ] =
                    this.getMaximum(
                        resourceId
                    );

                need[
                    resourceId
                ] =
                    this.getNeed(
                        resourceId
                    );
            }
        );


        return {

            pid:
                this.pid,

            allocation,

            maximum,

            need
        };
    }
}


/* ============================================================
   BANKER'S ALGORITHM
   ============================================================ */

class BankersAlgorithm {

    static checkSafety(
        processes,
        resources
    ) {

        const resourceIds =
            resources.map(
                resource =>
                    resource.id
            );


        const work = {};


        resources.forEach(
            resource => {

                work[
                    resource.id
                ] =
                    resource.available;
            }
        );


        const finish = new Map();


        processes.forEach(
            process => {

                finish.set(
                    process.pid,
                    false
                );
            }
        );


        const sequence = [];

        let progress = true;


        while (
            progress
        ) {

            progress = false;


            for (
                const process
                of processes
            ) {

                if (
                    finish.get(
                        process.pid
                    )
                ) {

                    continue;
                }


                let canFinish =
                    true;


                for (
                    const resourceId
                    of resourceIds
                ) {

                    const required =
                        process.getNeed(
                            resourceId
                        );


                    if (
                        required >
                        (
                            work[
                                resourceId
                            ] || 0
                        )
                    ) {

                        canFinish =
                            false;

                        break;
                    }
                }


                if (
                    !canFinish
                ) {

                    continue;
                }


                /*
                 * Pretend this process completes
                 * and releases its allocated resources.
                 */

                for (
                    const resourceId
                    of resourceIds
                ) {

                    work[
                        resourceId
                    ] +=
                        process.getAllocation(
                            resourceId
                        );
                }


                finish.set(
                    process.pid,
                    true
                );

                sequence.push(
                    process.pid
                );

                progress =
                    true;
            }
        }


        const unfinished =
            processes
                .filter(
                    process =>
                        !finish.get(
                            process.pid
                        )
                )
                .map(
                    process =>
                        process.pid
                );


        return {

            safe:
                unfinished.length === 0,

            sequence,

            unfinished,

            work
        };
    }


    static requestCanBeGranted(
        processes,
        resources,
        pid,
        request
    ) {

        const process =
            processes.find(
                item =>
                    item.pid ===
                    Number(pid)
            );


        if (
            !process
        ) {

            return {

                granted: false,

                safe: false,

                error:
                    "Process not found."
            };
        }


        const resourceIds =
            resources.map(
                resource =>
                    resource.id
            );


        /*
         * Validate request <= need
         * and request <= available.
         */

        for (
            const resourceId
            of resourceIds
        ) {

            const amount =
                Math.max(
                    0,
                    Number(
                        request[
                            resourceId
                        ]
                    ) || 0
                );


            const need =
                process.getNeed(
                    resourceId
                );


            const available =
                resources.find(
                    resource =>
                        resource.id ===
                        resourceId
                ).available;


            if (
                amount >
                need
            ) {

                return {

                    granted: false,

                    safe: false,

                    error:
                        `Request for ${resourceId} exceeds process need.`
                };
            }


            if (
                amount >
                available
            ) {

                return {

                    granted: false,

                    safe: false,

                    error:
                        `Insufficient available instances of ${resourceId}.`
                };
            }
        }


        /*
         * Create a temporary state.
         */

        const temporaryResources =
            resources.map(
                resource => {

                    const copy =
                        new OSResource(
                            resource.id,
                            resource.name,
                            resource.instances
                        );

                    copy.available =
                        resource.available;

                    return copy;
                }
            );


        const temporaryProcesses =
            processes.map(
                original => {

                    const copy =
                        new ResourceProcessState(
                            original.pid
                        );


                    resourceIds.forEach(
                        resourceId => {

                            copy.setMaximum(
                                resourceId,
                                original.getMaximum(
                                    resourceId
                                )
                            );

                            copy.setAllocation(
                                resourceId,
                                original.getAllocation(
                                    resourceId
                                )
                            );
                        }
                    );


                    return copy;
                }
            );


        const temporaryProcess =
            temporaryProcesses.find(
                item =>
                    item.pid ===
                    Number(pid)
            );


        /*
         * Pretend allocation happens.
         */

        resourceIds.forEach(
            resourceId => {

                const amount =
                    Math.max(
                        0,
                        Number(
                            request[
                                resourceId
                            ]
                        ) || 0
                    );


                if (
                    amount > 0
                ) {

                    const resource =
                        temporaryResources.find(
                            item =>
                                item.id ===
                                resourceId
                        );


                    resource.available -=
                        amount;


                    temporaryProcess.setAllocation(
                        resourceId,
                        temporaryProcess.getAllocation(
                            resourceId
                        ) +
                        amount
                    );
                }
            }
        );


        const safety =
            BankersAlgorithm.checkSafety(
                temporaryProcesses,
                temporaryResources
            );


        return {

            granted:
                safety.safe,

            safe:
                safety.safe,

            sequence:
                safety.sequence,

            unfinished:
                safety.unfinished,

            error:
                safety.safe
                    ? null
                    : "Request would place the system in an unsafe state."
        };
    }
}


/* ============================================================
   SEMAPHORE
   ============================================================ */

class OSSemaphore {

    constructor(
        id,
        initialValue = 1
    ) {

        this.id =
            String(id);

        this.initialValue =
            Math.max(
                0,
                Number(initialValue) || 0
            );

        this.value =
            this.initialValue;

        this.waitQueue = [];

        this.history = [];
    }


    wait(
        pid
    ) {

        pid =
            Number(pid);


        if (
            this.value > 0
        ) {

            this.value--;

            this.history.push({
                type: "WAIT_GRANTED",
                pid,
                timestamp:
                    Date.now()
            });


            return {

                success: true,

                blocked: false,

                value:
                    this.value
            };
        }


        if (
            !this.waitQueue.includes(
                pid
            )
        ) {

            this.waitQueue.push(
                pid
            );
        }


        this.history.push({
            type: "WAIT_BLOCKED",
            pid,
            timestamp:
                Date.now()
        });


        return {

            success: true,

            blocked: true,

            value:
                this.value
        };
    }


    signal(
        pid = null
    ) {

        if (
            this.waitQueue.length
        ) {

            const awakened =
                this.waitQueue.shift();


            this.history.push({
                type: "SIGNAL_WAKE",
                pid:
                    Number(pid),
                awakened,
                timestamp:
                    Date.now()
            });


            return {

                success: true,

                awakened,

                value:
                    this.value
            };
        }


        this.value++;


        this.history.push({
            type: "SIGNAL_INCREMENT",
            pid:
                pid === null
                    ? null
                    : Number(pid),
            timestamp:
                Date.now()
        });


        return {

            success: true,

            awakened: null,

            value:
                this.value
        };
    }


    reset() {

        this.value =
            this.initialValue;

        this.waitQueue = [];

        this.history = [];
    }


    snapshot() {

        return {

            id:
                this.id,

            value:
                this.value,

            initialValue:
                this.initialValue,

            waitQueue:
                [...this.waitQueue],

            history:
                [...this.history]
        };
    }
}


/* ============================================================
   DEADLOCK MANAGER
   ============================================================ */

class DeadlockManager {

    constructor() {

        this.resources =
            new Map();

        this.processes =
            new Map();

        this.semaphores =
            new Map();

        this.events = [];

        this.autoResourceCounter =
            1;

        this.autoSemaphoreCounter =
            1;


        this.log(
            "INFO",
            "Deadlock manager initialized."
        );
    }


    /* --------------------------------------------------------
       RESOURCE MANAGEMENT
       -------------------------------------------------------- */

    createResource(
        id,
        name,
        instances = 1
    ) {

        id =
            String(
                id ||
                `R${this.autoResourceCounter++}`
            );


        if (
            this.resources.has(id)
        ) {

            return {

                success: false,

                error:
                    `Resource ${id} already exists.`
            };
        }


        const resource =
            new OSResource(
                id,
                name || id,
                instances
            );


        this.resources.set(
            id,
            resource
        );


        this.record(
            "RESOURCE_CREATED",
            {
                resource:
                    resource.snapshot()
            }
        );


        return {

            success: true,

            resource:
                resource.snapshot()
        };
    }


    removeResource(
        id
    ) {

        id =
            String(id);


        if (
            !this.resources.has(id)
        ) {

            return {

                success: false,

                error:
                    "Resource not found."
            };
        }


        /*
         * Do not remove resources
         * that are currently allocated.
         */

        const resource =
            this.resources.get(id);


        if (
            resource.available !==
            resource.instances
        ) {

            return {

                success: false,

                error:
                    "Cannot remove an allocated resource."
            };
        }


        this.resources.delete(
            id
        );


        this.processes.forEach(
            process => {

                process.maximum.delete(
                    id
                );

                process.allocation.delete(
                    id
                );

                process.need.delete(
                    id
                );
            }
        );


        return {
            success: true
        };
    }


    /* --------------------------------------------------------
       PROCESS REGISTRATION
       -------------------------------------------------------- */

    registerProcess(
        pid
    ) {

        pid =
            Number(pid);


        if (
            !Number.isInteger(pid)
        ) {

            return {

                success: false,

                error:
                    "Invalid PID."
            };
        }


        if (
            this.processes.has(pid)
        ) {

            return {

                success: true,

                existing: true
            };
        }


        const process =
            new ResourceProcessState(
                pid
            );


        this.processes.set(
            pid,
            process
        );


        this.resources.forEach(
            resource => {

                process.setMaximum(
                    resource.id,
                    0
                );

                process.setAllocation(
                    resource.id,
                    0
                );
            }
        );


        return {

            success: true,

            pid
        };
    }


    unregisterProcess(
        pid
    ) {

        pid =
            Number(pid);


        const process =
            this.processes.get(
                pid
            );


        if (
            !process
        ) {

            return {

                success: false,

                error:
                    "Process not registered."
            };
        }


        /*
         * Release all currently
         * allocated resources.
         */

        this.resources.forEach(
            resource => {

                const amount =
                    process.getAllocation(
                        resource.id
                    );


                resource.available +=
                    amount;
            }
        );


        this.processes.delete(
            pid
        );


        return {
            success: true
        };
    }


    setMaximum(
        pid,
        resourceId,
        amount
    ) {

        resourceId =
            String(resourceId);


        if (
            !this.resources.has(
                resourceId
            )
        ) {

            return {

                success: false,

                error:
                    "Resource not found."
            };
        }


        const registration =
            this.registerProcess(
                pid
            );


        if (
            !registration.success
        ) {
            return registration;
        }


        const process =
            this.processes.get(
                Number(pid)
            );


        amount =
            Math.max(
                0,
                Number(amount) || 0
            );


        process.setMaximum(
            resourceId,
            amount
        );


        /*
         * Maximum claim cannot be smaller
         * than current allocation.
         */

        if (
            amount <
            process.getAllocation(
                resourceId
            )
        ) {

            process.setMaximum(
                resourceId,
                process.getAllocation(
                    resourceId
                )
            );
        }


        return {

            success: true,

            pid:
                Number(pid),

            resource:
                resourceId,

            maximum:
                process.getMaximum(
                    resourceId
                ),

            need:
                process.getNeed(
                    resourceId
                )
        };
    }


    /* --------------------------------------------------------
       REQUEST RESOURCE
       -------------------------------------------------------- */

    request(
        pid,
        request
    ) {

        pid =
            Number(pid);


        const process =
            this.processes.get(
                pid
            );


        if (
            !process
        ) {

            return {

                success: false,

                granted: false,

                error:
                    "Process not registered."
            };
        }


        const resourceList =
            [...this.resources.values()];


        const result =
            BankersAlgorithm
                .requestCanBeGranted(
                    [...this.processes.values()],
                    resourceList,
                    pid,
                    request || {}
                );


        this.record(
            result.granted
                ? "RESOURCE_GRANTED"
                : "RESOURCE_DENIED",
            {
                pid,
                request:
                    { ...request },
                safe:
                    result.safe,
                error:
                    result.error
            }
        );


        if (
            !result.granted
        ) {

            return {

                success: true,

                granted: false,

                safe:
                    result.safe,

                sequence:
                    result.sequence,

                error:
                    result.error
            };
        }


        /*
         * Commit allocation.
         */

        Object.entries(
            request || {}
        ).forEach(
            ([resourceId, amount]) => {

                amount =
                    Math.max(
                        0,
                        Number(amount) || 0
                    );


                if (
                    amount === 0
                ) {
                    return;
                }


                const resource =
                    this.resources.get(
                        String(resourceId)
                    );


                if (
                    !resource
                ) {
                    return;
                }


                resource.available -=
                    amount;


                process.setAllocation(
                    resource.id,
                    process.getAllocation(
                        resource.id
                    ) +
                    amount
                );
            }
        );


        return {

            success: true,

            granted: true,

            safe: true,

            sequence:
                result.sequence
        };
    }


    /* --------------------------------------------------------
       RELEASE RESOURCE
       -------------------------------------------------------- */

    release(
        pid,
        release
    ) {

        pid =
            Number(pid);


        const process =
            this.processes.get(
                pid
            );


        if (
            !process
        ) {

            return {

                success: false,

                error:
                    "Process not registered."
            };
        }


        Object.entries(
            release || {}
        ).forEach(
            ([resourceId, amount]) => {

                resourceId =
                    String(resourceId);

                amount =
                    Math.max(
                        0,
                        Number(amount) || 0
                    );


                const resource =
                    this.resources.get(
                        resourceId
                    );


                if (
                    !resource
                ) {
                    return;
                }


                const allocated =
                    process.getAllocation(
                        resourceId
                    );


                const actual =
                    Math.min(
                        amount,
                        allocated
                    );


                resource.available +=
                    actual;


                process.setAllocation(
                    resourceId,
                    allocated -
                    actual
                );
            }
        );


        this.record(
            "RESOURCE_RELEASED",
            {
                pid,
                release:
                    { ...release }
            }
        );


        return {

            success: true,

            state:
                this.getState()
        };
    }


    /* --------------------------------------------------------
       DEADLOCK DETECTION
       -------------------------------------------------------- */

    detectDeadlock() {

        const resources =
            [...this.resources.values()];

        const processes =
            [...this.processes.values()];


        const work = {};


        resources.forEach(
            resource => {

                work[
                    resource.id
                ] =
                    resource.available;
            }
        );


        const finish = new Map();


        processes.forEach(
            process => {

                let hasAllocation =
                    false;


                resources.forEach(
                    resource => {

                        if (
                            process.getAllocation(
                                resource.id
                            ) > 0
                        ) {

                            hasAllocation =
                                true;
                        }
                    }
                );


                finish.set(
                    process.pid,
                    !hasAllocation
                );
            }
        );


        const sequence = [];

        let changed = true;


        while (
            changed
        ) {

            changed = false;


            for (
                const process
                of processes
            ) {

                if (
                    finish.get(
                        process.pid
                    )
                ) {

                    continue;
                }


                let possible =
                    true;


                for (
                    const resource
                    of resources
                ) {

                    if (
                        process.getNeed(
                            resource.id
                        ) >
                        (
                            work[
                                resource.id
                            ] || 0
                        )
                    ) {

                        possible =
                            false;

                        break;
                    }
                }


                if (
                    possible
                ) {

                    resources.forEach(
                        resource => {

                            work[
                                resource.id
                            ] +=
                                process.getAllocation(
                                    resource.id
                                );
                        }
                    );


                    finish.set(
                        process.pid,
                        true
                    );

                    sequence.push(
                        process.pid
                    );

                    changed =
                        true;
                }
            }
        }


        const deadlocked =
            processes
                .filter(
                    process =>
                        !finish.get(
                            process.pid
                        )
                )
                .map(
                    process =>
                        process.pid
                );


        const result = {

            deadlock:
                deadlocked.length > 0,

            deadlocked,

            sequence,

            available:
                { ...work }
        };


        this.record(
            result.deadlock
                ? "DEADLOCK_DETECTED"
                : "NO_DEADLOCK",
            result
        );


        return result;
    }


    /* --------------------------------------------------------
       SAFETY CHECK
       -------------------------------------------------------- */

    checkSafety() {

        return BankersAlgorithm.checkSafety(
            [...this.processes.values()],
            [...this.resources.values()]
        );
    }


    /* --------------------------------------------------------
       RESOURCE ALLOCATION GRAPH
       -------------------------------------------------------- */

    getResourceAllocationGraph() {

        const nodes = [];

        const edges = [];


        this.processes.forEach(
            process => {

                nodes.push({

                    id:
                        `P${process.pid}`,

                    type:
                        "process",

                    pid:
                        process.pid
                });
            }
        );


        this.resources.forEach(
            resource => {

                nodes.push({

                    id:
                        resource.id,

                    type:
                        "resource",

                    name:
                        resource.name,

                    instances:
                        resource.instances,

                    available:
                        resource.available
                });
            }
        );


        this.processes.forEach(
            process => {

                this.resources.forEach(
                    resource => {

                        const allocated =
                            process.getAllocation(
                                resource.id
                            );


                        const need =
                            process.getNeed(
                                resource.id
                            );


                        if (
                            allocated > 0
                        ) {

                            edges.push({

                                from:
                                    resource.id,

                                to:
                                    `P${process.pid}`,

                                type:
                                    "allocation",

                                amount:
                                    allocated
                            });
                        }


                        if (
                            need > 0
                        ) {

                            edges.push({

                                from:
                                    `P${process.pid}`,

                                to:
                                    resource.id,

                                type:
                                    "request",

                                amount:
                                    need
                            });
                        }
                    }
                );
            }
        );


        return {
            nodes,
            edges
        };
    }


    /* --------------------------------------------------------
       WAIT-FOR GRAPH
       -------------------------------------------------------- */

    getWaitForGraph() {

        const nodes = [];

        const edges = [];


        this.processes.forEach(
            process => {

                nodes.push(
                    process.pid
                );
            }
        );


        const processList =
            [...this.processes.values()];


        processList.forEach(
            waitingProcess => {

                this.resources.forEach(
                    resource => {

                        const need =
                            waitingProcess.getNeed(
                                resource.id
                            );


                        if (
                            need <= 0
                        ) {
                            return;
                        }


                        const holders =
                            processList.filter(
                                holder =>
                                    holder.pid !==
                                        waitingProcess.pid &&
                                    holder.getAllocation(
                                        resource.id
                                    ) > 0
                            );


                        holders.forEach(
                            holder => {

                                if (
                                    !edges.some(
                                        edge =>
                                            edge.from ===
                                                waitingProcess.pid &&
                                            edge.to ===
                                                holder.pid
                                    )
                                ) {

                                    edges.push({

                                        from:
                                            waitingProcess.pid,

                                        to:
                                            holder.pid,

                                        resource:
                                            resource.id
                                    });
                                }
                            }
                        );
                    }
                );
            }
        );


        return {
            nodes,
            edges
        };
    }


    /* --------------------------------------------------------
       SEMAPHORES
       -------------------------------------------------------- */

    createSemaphore(
        id,
        initialValue = 1
    ) {

        id =
            String(
                id ||
                `S${this.autoSemaphoreCounter++}`
            );


        if (
            this.semaphores.has(id)
        ) {

            return {

                success: false,

                error:
                    "Semaphore already exists."
            };
        }


        const semaphore =
            new OSSemaphore(
                id,
                initialValue
            );


        this.semaphores.set(
            id,
            semaphore
        );


        return {

            success: true,

            semaphore:
                semaphore.snapshot()
        };
    }


    semaphoreWait(
        id,
        pid
    ) {

        const semaphore =
            this.semaphores.get(
                String(id)
            );


        if (
            !semaphore
        ) {

            return {

                success: false,

                error:
                    "Semaphore not found."
            };
        }


        return semaphore.wait(
            pid
        );
    }


    semaphoreSignal(
        id,
        pid = null
    ) {

        const semaphore =
            this.semaphores.get(
                String(id)
            );


        if (
            !semaphore
        ) {

            return {

                success: false,

                error:
                    "Semaphore not found."
            };
        }


        return semaphore.signal(
            pid
        );
    }


    getSemaphore(
        id
    ) {

        const semaphore =
            this.semaphores.get(
                String(id)
            );


        return semaphore
            ? semaphore.snapshot()
            : null;
    }


    /* --------------------------------------------------------
       STATE
       -------------------------------------------------------- */

    getState() {

        const resources = {};


        this.resources.forEach(
            (resource, id) => {

                resources[id] =
                    resource.snapshot();
            }
        );


        const processes = {};


        this.processes.forEach(
            (process, pid) => {

                processes[pid] =
                    process.snapshot(
                        [...this.resources.keys()]
                    );
            }
        );


        return {

            resources,

            processes,

            semaphores:
                Object.fromEntries(
                    [...this.semaphores]
                        .map(
                            ([id, semaphore]) =>
                                [
                                    id,
                                    semaphore.snapshot()
                                ]
                        )
                )
        };
    }


    /* --------------------------------------------------------
       RESET
       -------------------------------------------------------- */

    reset() {

        this.resources.clear();

        this.processes.clear();

        this.semaphores.clear();

        this.events = [];

        this.autoResourceCounter =
            1;

        this.autoSemaphoreCounter =
            1;


        this.log(
            "INFO",
            "Deadlock subsystem reset."
        );


        return {
            success: true
        };
    }


    /* --------------------------------------------------------
       EVENT HISTORY
       -------------------------------------------------------- */

    record(
        type,
        data = {}
    ) {

        this.events.unshift({

            type,

            timestamp:
                Date.now(),

            data:
                structuredClone
                    ? structuredClone(data)
                    : JSON.parse(
                        JSON.stringify(data)
                    )
        });


        if (
            this.events.length >
            500
        ) {

            this.events.length =
                500;
        }
    }


    getEvents(
        limit = 100
    ) {

        return this.events.slice(
            0,
            Math.max(
                1,
                Number(limit) || 100
            )
        );
    }


    /* --------------------------------------------------------
       LOGGING
       -------------------------------------------------------- */

    log(
        level,
        message
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


/* ============================================================
   GLOBAL INSTANCE
   ============================================================ */

window.deadlockManager =
    new DeadlockManager();


/* ============================================================
   PUBLIC API
   ============================================================ */

window.DeadlockAPI = {

    createResource(
        id,
        name,
        instances
    ) {

        return window.deadlockManager
            .createResource(
                id,
                name,
                instances
            );
    },


    removeResource(
        id
    ) {

        return window.deadlockManager
            .removeResource(
                id
            );
    },


    registerProcess(
        pid
    ) {

        return window.deadlockManager
            .registerProcess(
                pid
            );
    },


    unregisterProcess(
        pid
    ) {

        return window.deadlockManager
            .unregisterProcess(
                pid
            );
    },


    setMaximum(
        pid,
        resourceId,
        amount
    ) {

        return window.deadlockManager
            .setMaximum(
                pid,
                resourceId,
                amount
            );
    },


    request(
        pid,
        request
    ) {

        return window.deadlockManager
            .request(
                pid,
                request
            );
    },


    release(
        pid,
        release
    ) {

        return window.deadlockManager
            .release(
                pid,
                release
            );
    },


    detect() {

        return window.deadlockManager
            .detectDeadlock();
    },


    safety() {

        return window.deadlockManager
            .checkSafety();
    },


    allocationGraph() {

        return window.deadlockManager
            .getResourceAllocationGraph();
    },


    waitForGraph() {

        return window.deadlockManager
            .getWaitForGraph();
    },


    createSemaphore(
        id,
        value
    ) {

        return window.deadlockManager
            .createSemaphore(
                id,
                value
            );
    },


    wait(
        id,
        pid
    ) {

        return window.deadlockManager
            .semaphoreWait(
                id,
                pid
            );
    },


    signal(
        id,
        pid
    ) {

        return window.deadlockManager
            .semaphoreSignal(
                id,
                pid
            );
    },


    semaphore(
        id
    ) {

        return window.deadlockManager
            .getSemaphore(
                id
            );
    },


    state() {

        return window.deadlockManager
            .getState();
    },


    events(
        limit
    ) {

        return window.deadlockManager
            .getEvents(
                limit
            );
    },


    reset() {

        return window.deadlockManager
            .reset();
    }
};


/* ============================================================
   AUTOMATIC PROCESS DISCOVERY
   ============================================================ */

function initializeDeadlockProcesses() {

    const manager =
        window.processManager;


    if (
        !manager ||
        typeof manager.getAllProcesses !==
            "function"
    ) {

        return;
    }


    manager
        .getAllProcesses()
        .forEach(
            process => {

                window.deadlockManager
                    .registerProcess(
                        process.pid
                    );
            }
        );
}


if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeDeadlockProcesses
    );

} else {

    initializeDeadlockProcesses();
}


/* ============================================================
   PROCESS CREATION BRIDGE
   ============================================================ */

window.addEventListener(
    "os-process-created",
    event => {

        const pid =
            event.detail?.pid;


        if (
            pid !== undefined
        ) {

            window.deadlockManager
                .registerProcess(
                    pid
                );
        }
    }
);


/* ============================================================
   PERIODIC DISCOVERY
   ============================================================ */

setInterval(
    () => {

        const manager =
            window.processManager;


        if (
            !manager ||
            typeof manager.getAllProcesses !==
                "function"
        ) {

            return;
        }


        manager
            .getAllProcesses()
            .forEach(
                process => {

                    if (
                        !window.deadlockManager
                            .processes
                            .has(
                                Number(
                                    process.pid
                                )
                            )
                    ) {

                        window.deadlockManager
                            .registerProcess(
                                process.pid
                            );
                    }
                }
            );

    },
    5000
);