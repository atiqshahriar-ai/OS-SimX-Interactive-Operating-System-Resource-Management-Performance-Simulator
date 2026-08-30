"use strict";

/*
 * ============================================================
 * OS-SimX — DISK SCHEDULING SUBSYSTEM
 * ============================================================
 *
 * Algorithms:
 *   FCFS
 *   SSTF
 *   SCAN
 *   C-SCAN
 *   LOOK
 *   C-LOOK
 *
 * Provides:
 *   - Request simulation
 *   - Head movement calculation
 *   - Total seek distance
 *   - Average seek distance
 *   - Service sequence
 *   - Per-request movement
 *   - Algorithm comparison
 *   - Timeline generation
 * ============================================================
 */

class DiskRequest {

    constructor(track, index) {

        this.track =
            Number(track);

        this.index =
            index;

        this.movement =
            0;

        this.servedAt =
            null;
    }
}


class DiskScheduler {

    constructor() {

        this.diskSize = 200;

        this.initialHead = 50;

        this.direction = "right";

        this.requests = [];

        this.history = [];

        this.lastResult = null;
    }


    setDiskSize(size) {

        size =
            Number(size);

        if (
            !Number.isInteger(size) ||
            size < 2
        ) {

            return {
                success: false,
                error:
                    "Disk size must be an integer greater than 1."
            };
        }

        this.diskSize =
            size;

        return {
            success: true,
            diskSize:
                this.diskSize
        };
    }


    setHead(position) {

        position =
            Number(position);

        if (
            !Number.isInteger(position) ||
            position < 0 ||
            position >= this.diskSize
        ) {

            return {
                success: false,
                error:
                    "Invalid initial head position."
            };
        }

        this.initialHead =
            position;

        return {
            success: true,
            head:
                position
        };
    }


    setDirection(direction) {

        direction =
            String(direction)
                .toLowerCase();

        if (
            direction !== "left" &&
            direction !== "right"
        ) {

            return {
                success: false,
                error:
                    "Direction must be left or right."
            };
        }

        this.direction =
            direction;

        return {
            success: true,
            direction
        };
    }


    setRequests(requests) {

        if (
            !Array.isArray(requests)
        ) {

            return {
                success: false,
                error:
                    "Requests must be an array."
            };
        }

        const parsed =
            requests
                .map(Number)
                .filter(
                    track =>
                        Number.isInteger(track) &&
                        track >= 0 &&
                        track < this.diskSize
                );

        this.requests =
            parsed;

        return {
            success: true,
            requests:
                [...this.requests]
        };
    }


    addRequest(track) {

        track =
            Number(track);

        if (
            !Number.isInteger(track) ||
            track < 0 ||
            track >= this.diskSize
        ) {

            return {
                success: false,
                error:
                    "Invalid disk track."
            };
        }

        this.requests.push(track);

        return {
            success: true,
            track
        };
    }


    clearRequests() {

        this.requests = [];

        return {
            success: true
        };
    }


    distance(a, b) {

        return Math.abs(
            Number(a) -
            Number(b)
        );
    }


    createResult(
        algorithm,
        sequence,
        startHead
    ) {

        let current =
            startHead;

        let totalMovement =
            0;

        const movements = [];

        sequence.forEach(
            (track, index) => {

                const movement =
                    this.distance(
                        current,
                        track
                    );

                totalMovement +=
                    movement;

                movements.push({

                    from:
                        current,

                    to:
                        track,

                    movement,

                    requestIndex:
                        track === null
                            ? null
                            : index,

                    step:
                        index + 1
                });

                current =
                    track;
            }
        );


        const requestCount =
            this.requests.length;

        const average =
            requestCount === 0
                ? 0
                : totalMovement /
                  requestCount;


        const result = {

            algorithm,

            initialHead:
                startHead,

            finalHead:
                current,

            direction:
                this.direction,

            diskSize:
                this.diskSize,

            requestCount,

            requestQueue:
                [...this.requests],

            serviceSequence:
                [...sequence],

            movements,

            totalMovement,

            averageMovement:
                Number(
                    average.toFixed(2)
                ),

            timestamp:
                Date.now()
        };


        this.lastResult =
            result;

        this.history.unshift(
            result
        );

        if (
            this.history.length >
            50
        ) {

            this.history.length =
                50;
        }


        return result;
    }


    fcfs() {

        return this.createResult(
            "FCFS",
            [...this.requests],
            this.initialHead
        );
    }


    sstf() {

        const pending =
            this.requests.map(
                (track, index) =>
                    new DiskRequest(
                        track,
                        index
                    )
            );

        const sequence = [];

        let current =
            this.initialHead;


        while (
            pending.length > 0
        ) {

            let bestIndex =
                0;

            let bestDistance =
                Infinity;


            pending.forEach(
                (request, index) => {

                    const distance =
                        this.distance(
                            current,
                            request.track
                        );


                    /*
                     * Tie-breaker:
                     * earlier request wins.
                     */

                    if (
                        distance <
                        bestDistance
                    ) {

                        bestDistance =
                            distance;

                        bestIndex =
                            index;

                    } else if (
                        distance ===
                        bestDistance
                    ) {

                        if (
                            request.index <
                            pending[
                                bestIndex
                            ].index
                        ) {

                            bestIndex =
                                index;
                        }
                    }
                }
            );


            const selected =
                pending.splice(
                    bestIndex,
                    1
                )[0];


            sequence.push(
                selected.track
            );

            current =
                selected.track;
        }


        return this.createResult(
            "SSTF",
            sequence,
            this.initialHead
        );
    }


    scan() {

        const requests =
            [...this.requests]
                .sort(
                    (a, b) =>
                        a - b
                );


        const left =
            requests.filter(
                track =>
                    track <
                    this.initialHead
            )
                .reverse();


        const right =
            requests.filter(
                track =>
                    track >=
                    this.initialHead
            );


        const sequence = [];


        if (
            this.direction ===
            "right"
        ) {

            sequence.push(
                ...right
            );


            /*
             * SCAN physically reaches
             * the end of the disk.
             */

            if (
                sequence.length === 0 ||
                sequence[
                    sequence.length - 1
                ] !==
                    this.diskSize - 1
            ) {

                sequence.push(
                    this.diskSize - 1
                );
            }


            sequence.push(
                ...left
            );

        } else {

            sequence.push(
                ...left
            );


            if (
                sequence.length === 0 ||
                sequence[
                    sequence.length - 1
                ] !== 0
            ) {

                sequence.push(0);
            }


            sequence.push(
                ...right
            );
        }


        return this.createResult(
            "SCAN",
            sequence,
            this.initialHead
        );
    }


    cscan() {

        const requests =
            [...this.requests]
                .sort(
                    (a, b) =>
                        a - b
                );


        const left =
            requests.filter(
                track =>
                    track <
                    this.initialHead
            );


        const right =
            requests.filter(
                track =>
                    track >=
                    this.initialHead
            );


        const sequence = [];


        if (
            this.direction ===
            "right"
        ) {

            sequence.push(
                ...right
            );


            if (
                sequence.length === 0 ||
                sequence[
                    sequence.length - 1
                ] !==
                    this.diskSize - 1
            ) {

                sequence.push(
                    this.diskSize - 1
                );
            }


            /*
             * Circular jump to track 0.
             */

            if (
                left.length > 0
            ) {

                sequence.push(0);

                sequence.push(
                    ...left
                );
            }

        } else {

            sequence.push(
                ...left
                    .reverse()
            );


            if (
                sequence.length === 0 ||
                sequence[
                    sequence.length - 1
                ] !== 0
            ) {

                sequence.push(0);
            }


            if (
                right.length > 0
            ) {

                sequence.push(
                    this.diskSize - 1
                );

                sequence.push(
                    ...right.reverse()
                );
            }
        }


        return this.createResult(
            "C-SCAN",
            sequence,
            this.initialHead
        );
    }


    look() {

        const requests =
            [...this.requests]
                .sort(
                    (a, b) =>
                        a - b
                );


        const left =
            requests.filter(
                track =>
                    track <
                    this.initialHead
            )
                .reverse();


        const right =
            requests.filter(
                track =>
                    track >=
                    this.initialHead
            );


        const sequence = [];


        if (
            this.direction ===
            "right"
        ) {

            sequence.push(
                ...right
            );

            sequence.push(
                ...left
            );

        } else {

            sequence.push(
                ...left
            );

            sequence.push(
                ...right
            );
        }


        return this.createResult(
            "LOOK",
            sequence,
            this.initialHead
        );
    }


    clook() {

        const requests =
            [...this.requests]
                .sort(
                    (a, b) =>
                        a - b
                );


        const left =
            requests.filter(
                track =>
                    track <
                    this.initialHead
            );


        const right =
            requests.filter(
                track =>
                    track >=
                    this.initialHead
            );


        const sequence = [];


        if (
            this.direction ===
            "right"
        ) {

            sequence.push(
                ...right
            );

            sequence.push(
                ...left
            );

        } else {

            sequence.push(
                ...left.reverse()
            );

            sequence.push(
                ...right.reverse()
            );
        }


        return this.createResult(
            "C-LOOK",
            sequence,
            this.initialHead
        );
    }


    run(algorithm) {

        const normalized =
            String(
                algorithm ||
                "FCFS"
            )
                .trim()
                .toUpperCase()
                .replace(
                    /_/g,
                    "-"
                );


        switch (
            normalized
        ) {

            case "FCFS":
                return this.fcfs();

            case "SSTF":
                return this.sstf();

            case "SCAN":
                return this.scan();

            case "C-SCAN":
            case "CSCAN":
                return this.cscan();

            case "LOOK":
                return this.look();

            case "C-LOOK":
            case "CLOOK":
                return this.clook();

            default:

                return {
                    success: false,
                    error:
                        `Unknown disk scheduling algorithm: ${algorithm}`
                };
        }
    }


    compare() {

        const algorithms = [
            "FCFS",
            "SSTF",
            "SCAN",
            "C-SCAN",
            "LOOK",
            "C-LOOK"
        ];


        const results =
            algorithms.map(
                algorithm =>
                    this.run(
                        algorithm
                    )
            );


        const ranking =
            [...results]
                .sort(
                    (a, b) =>
                        a.totalMovement -
                        b.totalMovement
                )
                .map(
                    (result, index) => ({
                        rank:
                            index + 1,

                        algorithm:
                            result.algorithm,

                        totalMovement:
                            result.totalMovement,

                        averageMovement:
                            result.averageMovement
                    })
                );


        return {

            requests:
                [...this.requests],

            head:
                this.initialHead,

            direction:
                this.direction,

            diskSize:
                this.diskSize,

            results,

            ranking,

            best:
                ranking[0] || null
        };
    }


    generateRandomRequests(
        count = 10
    ) {

        count =
            Math.max(
                1,
                Math.min(
                    100,
                    Number(count) || 10
                )
            );


        const requests = [];


        for (
            let i = 0;
            i < count;
            i++
        ) {

            requests.push(
                Math.floor(
                    Math.random() *
                    this.diskSize
                )
            );
        }


        this.requests =
            requests;


        return {
            success: true,
            requests:
                [...requests]
        };
    }


    getResult() {

        return this.lastResult;
    }


    getHistory() {

        return [...this.history];
    }


    reset() {

        this.requests = [];

        this.history = [];

        this.lastResult =
            null;

        this.initialHead =
            Math.min(
                50,
                this.diskSize - 1
            );

        this.direction =
            "right";

        return {
            success: true
        };
    }


    snapshot() {

        return {

            diskSize:
                this.diskSize,

            initialHead:
                this.initialHead,

            direction:
                this.direction,

            requests:
                [...this.requests],

            lastResult:
                this.lastResult,

            history:
                [...this.history]
        };
    }
}


/* ============================================================
   GLOBAL INSTANCE
 * ============================================================ */

window.diskScheduler =
    new DiskScheduler();


/* ============================================================
   PUBLIC API
 * ============================================================ */

window.DiskAPI = {

    configure(
        diskSize,
        head,
        direction
    ) {

        const manager =
            window.diskScheduler;


        if (
            diskSize !== undefined
        ) {

            const result =
                manager.setDiskSize(
                    diskSize
                );


            if (
                !result.success
            ) {
                return result;
            }
        }


        if (
            head !== undefined
        ) {

            const result =
                manager.setHead(
                    head
                );


            if (
                !result.success
            ) {
                return result;
            }
        }


        if (
            direction !== undefined
        ) {

            const result =
                manager.setDirection(
                    direction
                );


            if (
                !result.success
            ) {
                return result;
            }
        }


        return {
            success: true,
            state:
                manager.snapshot()
        };
    },


    requests(
        requests
    ) {

        return window.diskScheduler
            .setRequests(
                requests
            );
    },


    add(
        track
    ) {

        return window.diskScheduler
            .addRequest(
                track
            );
    },


    clear() {

        return window.diskScheduler
            .clearRequests();
    },


    random(
        count
    ) {

        return window.diskScheduler
            .generateRandomRequests(
                count
            );
    },


    run(
        algorithm
    ) {

        return window.diskScheduler
            .run(
                algorithm
            );
    },


    compare() {

        return window.diskScheduler
            .compare();
    },


    result() {

        return window.diskScheduler
            .getResult();
    },


    history() {

        return window.diskScheduler
            .getHistory();
    },


    state() {

        return window.diskScheduler
            .snapshot();
    },


    reset() {

        return window.diskScheduler
            .reset();
    }
};


/* ============================================================
   OPTIONAL EVENT BRIDGE
 * ============================================================ */

window.addEventListener(
    "disk-request-added",
    event => {

        const track =
            event.detail?.track;

        if (
            track !== undefined
        ) {

            window.DiskAPI.add(
                track
            );
        }
    }
);


/* ============================================================
   INITIALIZATION
 * ============================================================ */

if (
    typeof window.addLog ===
    "function"
) {

    window.addLog(
        "INFO",
        "Disk scheduling subsystem loaded."
    );
}