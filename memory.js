"use strict";

/* =========================================================
   MEMORY MANAGEMENT SUBSYSTEM
   ========================================================= */

class MemoryBlock {
    constructor(start, size, process = "Free", type = "free") {
        this.start = start;
        this.size = size;
        this.process = process;
        this.type = type;
    }

    get end() {
        return this.start + this.size;
    }

    get isFree() {
        return this.type === "free";
    }
}


class MemoryManager {
    constructor(totalMemory = 1024, pageSize = 64) {
        this.totalMemory = totalMemory;
        this.pageSize = pageSize;

        this.blocks = [
            new MemoryBlock(
                0,
                totalMemory,
                "Free",
                "free"
            )
        ];

        this.allocations = new Map();

        this.pageTable = new Map();

        this.nextFrame = 0;

        this.statistics = {
            allocations: 0,
            deallocations: 0,
            failedAllocations: 0,
            compactions: 0,
            pageFaults: 0
        };
    }


    /* =====================================================
       BASIC INFORMATION
       ===================================================== */

    getUsedMemory() {
        return this.blocks
            .filter(
                (block) =>
                    !block.isFree
            )
            .reduce(
                (sum, block) =>
                    sum + block.size,
                0
            );
    }


    getFreeMemory() {
        return (
            this.totalMemory -
            this.getUsedMemory()
        );
    }


    getUtilization() {
        return (
            this.getUsedMemory() /
            this.totalMemory
        ) * 100;
    }


    getLargestFreeBlock() {
        return this.blocks
            .filter(
                (block) =>
                    block.isFree
            )
            .reduce(
                (largest, block) =>
                    Math.max(
                        largest,
                        block.size
                    ),
                0
            );
    }


    /* =====================================================
       FIRST FIT
       ===================================================== */

    firstFit(processName, size) {
        return this.allocate(
            processName,
            size,
            "first-fit"
        );
    }


    /* =====================================================
       BEST FIT
       ===================================================== */

    bestFit(processName, size) {
        return this.allocate(
            processName,
            size,
            "best-fit"
        );
    }


    /* =====================================================
       WORST FIT
       ===================================================== */

    worstFit(processName, size) {
        return this.allocate(
            processName,
            size,
            "worst-fit"
        );
    }


    /* =====================================================
       GENERIC ALLOCATION
       ===================================================== */

    allocate(
        processName,
        size,
        algorithm = "first-fit"
    ) {
        size = Number(size);

        if (
            !processName ||
            !Number.isFinite(size) ||
            size <= 0
        ) {
            return {
                success: false,
                reason: "Invalid allocation request."
            };
        }


        if (
            this.allocations.has(
                processName
            )
        ) {
            return {
                success: false,
                reason:
                    "Process already owns allocated memory."
            };
        }


        if (
            size >
            this.getFreeMemory()
        ) {
            this.statistics.failedAllocations++;

            this.log(
                "ERROR",
                `Memory allocation failed for ${processName}: insufficient memory.`
            );

            return {
                success: false,
                reason: "Insufficient memory."
            };
        }


        const candidates =
            this.blocks.filter(
                (block) =>
                    block.isFree &&
                    block.size >= size
            );


        if (!candidates.length) {
            this.statistics.failedAllocations++;

            this.log(
                "WARNING",
                `External fragmentation prevented allocation for ${processName}.`
            );

            return {
                success: false,
                reason:
                    "No contiguous block large enough."
            };
        }


        let selected;


        switch (algorithm) {
            case "best-fit":
                selected =
                    [...candidates].sort(
                        (a, b) =>
                            a.size - b.size
                    )[0];
                break;


            case "worst-fit":
                selected =
                    [...candidates].sort(
                        (a, b) =>
                            b.size - a.size
                    )[0];
                break;


            case "first-fit":
            default:
                selected =
                    candidates[0];
                break;
        }


        const allocated =
            new MemoryBlock(
                selected.start,
                size,
                processName,
                "used"
            );


        const remaining =
            selected.size - size;


        const index =
            this.blocks.indexOf(
                selected
            );


        this.blocks.splice(
            index,
            1
        );


        this.blocks.splice(
            index,
            0,
            allocated
        );


        if (remaining > 0) {
            this.blocks.splice(
                index + 1,
                0,
                new MemoryBlock(
                    selected.start + size,
                    remaining,
                    "Free",
                    "free"
                )
            );
        }


        this.allocations.set(
            processName,
            allocated
        );


        this.statistics.allocations++;


        this.syncLegacyMemory();


        this.log(
            "INFO",
            `Allocated ${size} MB to ${processName} using ${algorithm}.`
        );


        return {
            success: true,
            block: allocated
        };
    }


    /* =====================================================
       DEALLOCATION
       ===================================================== */

    deallocate(processName) {
        const allocation =
            this.allocations.get(
                processName
            );


        if (!allocation) {
            return false;
        }


        const index =
            this.blocks.indexOf(
                allocation
            );


        if (index === -1) {
            return false;
        }


        allocation.process =
            "Free";

        allocation.type =
            "free";


        this.allocations.delete(
            processName
        );


        this.statistics.deallocations++;


        this.mergeAdjacentFreeBlocks();


        this.syncLegacyMemory();


        this.log(
            "INFO",
            `Deallocated memory owned by ${processName}.`
        );


        return true;
    }


    /* =====================================================
       COALESCE / MERGE FREE BLOCKS
       ===================================================== */

    mergeAdjacentFreeBlocks() {
        this.blocks.sort(
            (a, b) =>
                a.start - b.start
        );


        const merged = [];


        for (const block of this.blocks) {
            const previous =
                merged[
                    merged.length - 1
                ];


            if (
                previous &&
                previous.isFree &&
                block.isFree &&
                previous.end ===
                    block.start
            ) {
                previous.size +=
                    block.size;
            } else {
                merged.push(
                    block
                );
            }
        }


        this.blocks =
            merged;
    }


    /* =====================================================
       COMPACTION
       ===================================================== */

    compact() {
        const used =
            this.blocks
                .filter(
                    (block) =>
                        !block.isFree
                )
                .sort(
                    (a, b) =>
                        a.start - b.start
                );


        let cursor = 0;


        used.forEach(
            (block) => {
                block.start =
                    cursor;

                cursor +=
                    block.size;
            }
        );


        const freeSize =
            this.totalMemory -
            cursor;


        this.blocks =
            used;


        if (freeSize > 0) {
            this.blocks.push(
                new MemoryBlock(
                    cursor,
                    freeSize,
                    "Free",
                    "free"
                )
            );
        }


        this.statistics.compactions++;


        this.syncLegacyMemory();


        this.log(
            "INFO",
            "Memory compaction completed."
        );


        return this.blocks;
    }


    /* =====================================================
       PAGING
       ===================================================== */

    createPageTable(
        processName,
        processSize
    ) {
        const pageCount =
            Math.ceil(
                processSize /
                    this.pageSize
            );


        const entries = [];


        for (
            let page = 0;
            page < pageCount;
            page++
        ) {
            const frame =
                this.nextFrame++;


            const entry = {
                page,
                frame,
                present: true,
                valid: true,
                referenced: false,
                dirty: false,
                protection: "RW"
            };


            this.pageTable.set(
                `${processName}:${page}`,
                entry
            );


            entries.push(
                entry
            );
        }


        return entries;
    }


    getPageEntry(
        processName,
        pageNumber
    ) {
        return this.pageTable.get(
            `${processName}:${pageNumber}`
        );
    }


    accessPage(
        processName,
        pageNumber,
        write = false
    ) {
        const entry =
            this.getPageEntry(
                processName,
                pageNumber
            );


        if (!entry) {
            this.statistics.pageFaults++;


            this.log(
                "WARNING",
                `Page fault: ${processName}, page ${pageNumber}.`
            );


            return {
                success: false,
                pageFault: true
            };
        }


        if (!entry.present) {
            this.statistics.pageFaults++;


            this.log(
                "WARNING",
                `Page fault: page ${pageNumber} not present.`
            );


            return {
                success: false,
                pageFault: true
            };
        }


        entry.referenced =
            true;


        if (write) {
            entry.dirty =
                true;
        }


        return {
            success: true,
            frame: entry.frame,
            physicalAddress:
                entry.frame *
                    this.pageSize
        };
    }


    translateAddress(
        processName,
        virtualAddress
    ) {
        virtualAddress =
            Number(
                virtualAddress
            );


        if (
            !Number.isInteger(
                virtualAddress
            ) ||
            virtualAddress < 0
        ) {
            return {
                success: false,
                reason:
                    "Invalid virtual address."
            };
        }


        const page =
            Math.floor(
                virtualAddress /
                    this.pageSize
            );


        const offset =
            virtualAddress %
            this.pageSize;


        const result =
            this.accessPage(
                processName,
                page
            );


        if (!result.success) {
            return result;
        }


        return {
            success: true,
            page,
            offset,
            frame: result.frame,
            physicalAddress:
                result.frame *
                    this.pageSize +
                offset
        };
    }


    invalidatePage(
        processName,
        pageNumber
    ) {
        const entry =
            this.getPageEntry(
                processName,
                pageNumber
            );


        if (!entry) {
            return false;
        }


        entry.present =
            false;


        return true;
    }


    /* =====================================================
       PAGE TABLE SNAPSHOT
       ===================================================== */

    getPageTable(processName) {
        const result = [];


        for (
            const [
                key,
                entry
            ] of this.pageTable
        ) {
            if (
                key.startsWith(
                    `${processName}:`
                )
            ) {
                result.push({
                    ...entry
                });
            }
        }


        return result.sort(
            (a, b) =>
                a.page - b.page
        );
    }


    /* =====================================================
       MEMORY MAP
       ===================================================== */

    getMemoryMap() {
        return this.blocks.map(
            (block) => ({
                start:
                    block.start,
                end:
                    block.end,
                size:
                    block.size,
                process:
                    block.process,
                type:
                    block.type
            })
        );
    }


    /* =====================================================
       FRAGMENTATION
       ===================================================== */

    getFragmentation() {
        const freeBlocks =
            this.blocks.filter(
                (block) =>
                    block.isFree
            );


        const totalFree =
            freeBlocks.reduce(
                (sum, block) =>
                    sum + block.size,
                0
            );


        const largest =
            this.getLargestFreeBlock();


        if (
            totalFree === 0
        ) {
            return 0;
        }


        return (
            1 -
            largest /
                totalFree
        ) * 100;
    }


    /* =====================================================
       LEGACY STATE SYNCHRONIZATION
       ===================================================== */

    syncLegacyMemory() {
        if (!window.OS) {
            return;
        }


        window.OS.memory.total =
            this.totalMemory;


        window.OS.memory.used =
            this.getUsedMemory();


        window.OS.memory.allocations =
            this.blocks
                .filter(
                    (block) =>
                        !block.isFree
                )
                .map(
                    (block) => ({
                        start:
                            block.start,
                        size:
                            block.size,
                        process:
                            block.process,
                        type:
                            block.type
                    })
                );
    }


    /* =====================================================
       LOGGING
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
       RESET
       ===================================================== */

    reset() {
        this.blocks = [
            new MemoryBlock(
                0,
                this.totalMemory,
                "Free",
                "free"
            )
        ];


        this.allocations.clear();
        this.pageTable.clear();


        this.nextFrame = 0;


        this.statistics = {
            allocations: 0,
            deallocations: 0,
            failedAllocations: 0,
            compactions: 0,
            pageFaults: 0
        };


        this.syncLegacyMemory();
    }
}


/* =========================================================
   GLOBAL MEMORY MANAGER
   ========================================================= */

window.memoryManager =
    new MemoryManager(
        1024,
        64
    );


/* =========================================================
   MEMORY API
   ========================================================= */

window.MemoryAPI = {

    allocate(
        processName,
        size,
        algorithm = "first-fit"
    ) {
        return window.memoryManager.allocate(
            processName,
            size,
            algorithm
        );
    },


    firstFit(
        processName,
        size
    ) {
        return window.memoryManager.firstFit(
            processName,
            size
        );
    },


    bestFit(
        processName,
        size
    ) {
        return window.memoryManager.bestFit(
            processName,
            size
        );
    },


    worstFit(
        processName,
        size
    ) {
        return window.memoryManager.worstFit(
            processName,
            size
        );
    },


    free(processName) {
        return window.memoryManager.deallocate(
            processName
        );
    },


    reset() {
        window.memoryManager.reset();
        return true;
    },


    compact() {
        return window.memoryManager.compact();
    },


    map() {
        return window.memoryManager.getMemoryMap();
    },


    stats() {
        return {
            total:
                window.memoryManager.totalMemory,

            used:
                window.memoryManager.getUsedMemory(),

            free:
                window.memoryManager.getFreeMemory(),

            utilization:
                window.memoryManager.getUtilization(),

            largestFree:
                window.memoryManager.getLargestFreeBlock(),

            fragmentation:
                window.memoryManager.getFragmentation(),

            ...window.memoryManager.statistics
        };
    },


    createPageTable(
        processName,
        size
    ) {
        return window.memoryManager.createPageTable(
            processName,
            size
        );
    },


    pageTable(processName) {
        return window.memoryManager.getPageTable(
            processName
        );
    },


    translate(
        processName,
        address
    ) {
        return window.memoryManager.translateAddress(
            processName,
            address
        );
    }
};


/* =========================================================
   BRIDGE TO app.js
   ========================================================= */

window.allocateMemory = function (
    processName,
    size
) {
    const result =
        window.memoryManager.allocate(
            processName,
            size,
            "first-fit"
        );


    if (
        typeof window.renderAll ===
        "function"
    ) {
        window.renderAll();
    }


    return result.success;
};


window.freeMemory = function (
    processName
) {
    const result =
        window.memoryManager.deallocate(
            processName
        );


    if (
        typeof window.renderAll ===
        "function"
    ) {
        window.renderAll();
    }


    return result;
};


/* =========================================================
   INITIAL LEGACY MEMORY MIGRATION
   ========================================================= */

function initializeMemoryManager() {
    if (
        !window.OS ||
        !window.OS.memory
    ) {
        return;
    }


    const legacy =
        window.OS.memory;


    if (
        Array.isArray(
            legacy.allocations
        ) &&
        legacy.allocations.length
    ) {
        window.memoryManager.blocks =
            [];


        let cursor = 0;


        const sorted =
            [...legacy.allocations]
                .sort(
                    (a, b) =>
                        a.start - b.start
                );


        sorted.forEach(
            (allocation) => {
                if (
                    allocation.start >
                    cursor
                ) {
                    window.memoryManager.blocks.push(
                        new MemoryBlock(
                            cursor,
                            allocation.start -
                                cursor,
                            "Free",
                            "free"
                        )
                    );
                }


                const block =
                    new MemoryBlock(
                        allocation.start,
                        allocation.size,
                        allocation.process,
                        allocation.type
                    );


                window.memoryManager.blocks.push(
                    block
                );


                if (
                    allocation.type !==
                    "free"
                ) {
                    window.memoryManager.allocations.set(
                        allocation.process,
                        block
                    );
                }


                cursor =
                    allocation.start +
                    allocation.size;
            }
        );


        if (
            cursor <
            legacy.total
        ) {
            window.memoryManager.blocks.push(
                new MemoryBlock(
                    cursor,
                    legacy.total -
                        cursor,
                    "Free",
                    "free"
                )
            );
        }
    }


    window.memoryManager.syncLegacyMemory();
}


if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        initializeMemoryManager,
        {
            once: true
        }
    );
} else {
    initializeMemoryManager();
}