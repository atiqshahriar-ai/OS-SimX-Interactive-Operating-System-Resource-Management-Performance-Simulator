"use strict";

/* =========================================================
   OS-SimX FILE SYSTEM SUBSYSTEM
   ========================================================= */

class FSNode {
    constructor(name, type, parent = null) {
        this.id =
            `node-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`;

        this.name = name;
        this.type = type;
        this.parent = parent;

        this.children = [];
        this.content = "";

        this.size = 0;

        this.createdAt = new Date();
        this.modifiedAt = new Date();

        this.permissions = "rw-r--r--";
        this.owner = "user";

        this.inode = null;
    }

    isDirectory() {
        return this.type === "directory";
    }

    isFile() {
        return this.type === "file";
    }

    getPath() {
        if (!this.parent) {
            return "/";
        }

        const parts = [];
        let current = this;

        while (
            current &&
            current.parent
        ) {
            parts.unshift(
                current.name
            );

            current = current.parent;
        }

        return "/" + parts.join("/");
    }
}


/* =========================================================
   INODE
   ========================================================= */

class Inode {
    constructor(number, node) {
        this.number = number;

        this.mode =
            node.type === "directory"
                ? "d"
                : "-";

        this.permissions =
            node.permissions;

        this.owner =
            node.owner;

        this.links = 1;

        this.size =
            node.size;

        this.blocks = 0;

        this.createdAt =
            node.createdAt;

        this.modifiedAt =
            node.modifiedAt;
    }
}


/* =========================================================
   FILE SYSTEM
   ========================================================= */

class FileSystem {
    constructor() {
        this.blockSize = 512;
        this.totalBlocks = 2048;

        this.usedBlocks = 0;

        this.nextInode = 1;

        this.root =
            new FSNode(
                "",
                "directory",
                null
            );

        this.root.inode =
            this.allocateInode(
                this.root
            );

        this.cwd =
            this.root;

        this.openFiles = new Map();

        this.fileDescriptors = new Map();

        this.nextFd = 3;

        this.mountPoint = "/";

        this.superblock = {
            magic: "OSXFS",
            version: 1,
            blockSize:
                this.blockSize,
            totalBlocks:
                this.totalBlocks,
            freeBlocks:
                this.totalBlocks
        };

        this.initializeDefaultFiles();
    }


    /* =====================================================
       INITIAL FILE SYSTEM
       ===================================================== */

    initializeDefaultFiles() {
        this.mkdir(
            "/home"
        );

        this.mkdir(
            "/home/user"
        );

        this.mkdir(
            "/tmp"
        );

        this.mkdir(
            "/var"
        );

        this.mkdir(
            "/var/log"
        );

        this.mkdir(
            "/bin"
        );

        this.touch(
            "/home/user/readme.txt"
        );

        this.writeFile(
            "/home/user/readme.txt",
            "Welcome to OS-SimX.\n"
        );

        this.touch(
            "/var/log/system.log"
        );

        this.writeFile(
            "/var/log/system.log",
            "OS-SimX filesystem initialized.\n"
        );
    }


    /* =====================================================
       PATH RESOLUTION
       ===================================================== */

    normalizePath(path) {
        if (
            typeof path !== "string" ||
            !path.trim()
        ) {
            return this.cwd.getPath();
        }

        let fullPath;

        if (
            path.startsWith("/")
        ) {
            fullPath = path;
        } else {
            const cwd =
                this.cwd.getPath();

            fullPath =
                cwd === "/"
                    ? `/${path}`
                    : `${cwd}/${path}`;
        }

        const parts =
            fullPath.split("/");

        const normalized = [];

        for (
            const part of parts
        ) {
            if (
                !part ||
                part === "."
            ) {
                continue;
            }

            if (
                part === ".."
            ) {
                normalized.pop();
            } else {
                normalized.push(
                    part
                );
            }
        }

        return "/" +
            normalized.join("/");
    }


    resolve(path) {
        const normalized =
            this.normalizePath(
                path
            );

        if (
            normalized === "/"
        ) {
            return this.root;
        }

        const parts =
            normalized
                .split("/")
                .filter(Boolean);

        let current =
            this.root;

        for (
            const part of parts
        ) {
            if (
                !current.isDirectory()
            ) {
                return null;
            }

            const child =
                current.children.find(
                    (node) =>
                        node.name ===
                        part
                );

            if (!child) {
                return null;
            }

            current = child;
        }

        return current;
    }


    resolveParent(path) {
        const normalized =
            this.normalizePath(
                path
            );

        if (
            normalized === "/"
        ) {
            return null;
        }

        const parts =
            normalized
                .split("/")
                .filter(Boolean);

        const name =
            parts.pop();

        const parentPath =
            "/" +
            parts.join("/");

        const parent =
            this.resolve(
                parentPath ||
                "/"
            );

        return {
            parent,
            name
        };
    }


    /* =====================================================
       INODE MANAGEMENT
       ===================================================== */

    allocateInode(node) {
        const inode =
            new Inode(
                this.nextInode++,
                node
            );

        return inode;
    }


    updateInode(node) {
        if (!node.inode) {
            node.inode =
                this.allocateInode(
                    node
                );
        }

        node.inode.size =
            node.size;

        node.inode.permissions =
            node.permissions;

        node.inode.modifiedAt =
            node.modifiedAt;

        node.inode.blocks =
            Math.ceil(
                node.size /
                    this.blockSize
            );

        return node.inode;
    }


    /* =====================================================
       BLOCK MANAGEMENT
       ===================================================== */

    blocksForSize(size) {
        if (size <= 0) {
            return 0;
        }

        return Math.ceil(
            size /
                this.blockSize
        );
    }


    allocateBlocks(size) {
        const blocks =
            this.blocksForSize(
                size
            );

        if (
            blocks >
            this.superblock.freeBlocks
        ) {
            return false;
        }

        this.usedBlocks +=
            blocks;

        this.superblock.freeBlocks =
            this.totalBlocks -
            this.usedBlocks;

        return true;
    }


    freeBlocks(size) {
        const blocks =
            this.blocksForSize(
                size
            );

        this.usedBlocks =
            Math.max(
                0,
                this.usedBlocks -
                    blocks
            );

        this.superblock.freeBlocks =
            this.totalBlocks -
            this.usedBlocks;
    }


    /* =====================================================
       DIRECTORY OPERATIONS
       ===================================================== */

    mkdir(path) {
        const result =
            this.resolveParent(
                path
            );

        if (
            !result ||
            !result.parent ||
            !result.parent.isDirectory()
        ) {
            return {
                success: false,
                error:
                    "Parent directory does not exist."
            };
        }

        if (
            !result.name
        ) {
            return {
                success: false,
                error:
                    "Invalid directory name."
            };
        }

        const existing =
            result.parent.children.find(
                (node) =>
                    node.name ===
                    result.name
            );

        if (existing) {
            return {
                success: false,
                error:
                    "File or directory already exists."
            };
        }

        const directory =
            new FSNode(
                result.name,
                "directory",
                result.parent
            );

        directory.inode =
            this.allocateInode(
                directory
            );

        result.parent.children.push(
            directory
        );

        this.touchParent(
            result.parent
        );

        this.log(
            "INFO",
            `Directory created: ${directory.getPath()}`
        );

        this.syncLegacyFS();

        return {
            success: true,
            node: directory
        };
    }


    rmdir(path) {
        const node =
            this.resolve(path);

        if (
            !node ||
            !node.isDirectory()
        ) {
            return {
                success: false,
                error:
                    "Directory not found."
            };
        }

        if (
            node === this.root
        ) {
            return {
                success: false,
                error:
                    "Cannot remove root directory."
            };
        }

        if (
            node.children.length
        ) {
            return {
                success: false,
                error:
                    "Directory is not empty."
            };
        }

        const parent =
            node.parent;

        parent.children =
            parent.children.filter(
                (child) =>
                    child !== node
            );

        this.touchParent(
            parent
        );

        this.log(
            "WARNING",
            `Directory removed: ${path}`
        );

        this.syncLegacyFS();

        return {
            success: true
        };
    }


    /* =====================================================
       FILE OPERATIONS
       ===================================================== */

    touch(path) {
        const existing =
            this.resolve(path);

        if (existing) {
            if (
                existing.isFile()
            ) {
                existing.modifiedAt =
                    new Date();

                this.updateInode(
                    existing
                );

                return {
                    success: true,
                    node: existing
                };
            }

            return {
                success: false,
                error:
                    "A directory already exists at this path."
            };
        }

        const result =
            this.resolveParent(
                path
            );

        if (
            !result ||
            !result.parent ||
            !result.parent.isDirectory()
        ) {
            return {
                success: false,
                error:
                    "Parent directory does not exist."
            };
        }

        const file =
            new FSNode(
                result.name,
                "file",
                result.parent
            );

        file.inode =
            this.allocateInode(
                file
            );

        result.parent.children.push(
            file
        );

        this.touchParent(
            result.parent
        );

        this.log(
            "INFO",
            `File created: ${file.getPath()}`
        );

        this.syncLegacyFS();

        return {
            success: true,
            node: file
        };
    }


    writeFile(
        path,
        content
    ) {
        const node =
            this.resolve(path);

        if (
            !node ||
            !node.isFile()
        ) {
            const created =
                this.touch(path);

            if (
                !created.success
            ) {
                return created;
            }
        }

        const file =
            this.resolve(path);

        content =
            String(
                content ?? ""
            );

        const oldSize =
            file.size;

        const newSize =
            content.length;

        const oldBlocks =
            this.blocksForSize(
                oldSize
            );

        const newBlocks =
            this.blocksForSize(
                newSize
            );

        const additional =
            newBlocks -
            oldBlocks;

        if (
            additional >
            this.superblock.freeBlocks
        ) {
            return {
                success: false,
                error:
                    "No space left on device."
            };
        }

        if (
            additional > 0
        ) {
            this.usedBlocks +=
                additional;
        } else if (
            additional < 0
        ) {
            this.usedBlocks =
                Math.max(
                    0,
                    this.usedBlocks +
                        additional
                );
        }

        this.superblock.freeBlocks =
            this.totalBlocks -
            this.usedBlocks;

        file.content =
            content;

        file.size =
            newSize;

        file.modifiedAt =
            new Date();

        this.updateInode(
            file
        );

        this.log(
            "INFO",
            `Wrote ${newSize} bytes to ${file.getPath()}.`
        );

        this.syncLegacyFS();

        return {
            success: true,
            node: file,
            bytes:
                newSize
        };
    }


    appendFile(
        path,
        content
    ) {
        const file =
            this.resolve(path);

        if (
            !file ||
            !file.isFile()
        ) {
            return {
                success: false,
                error:
                    "File not found."
            };
        }

        return this.writeFile(
            path,
            file.content +
                String(
                    content ?? ""
                )
        );
    }


    readFile(path) {
        const file =
            this.resolve(path);

        if (
            !file ||
            !file.isFile()
        ) {
            return {
                success: false,
                error:
                    "File not found."
            };
        }

        return {
            success: true,
            content:
                file.content
        };
    }


    rm(path) {
        const node =
            this.resolve(path);

        if (!node) {
            return {
                success: false,
                error:
                    "File not found."
            };
        }

        if (
            node === this.root
        ) {
            return {
                success: false,
                error:
                    "Cannot remove root."
            };
        }

        if (
            node.isDirectory()
        ) {
            return {
                success: false,
                error:
                    "Use rmdir for directories."
            };
        }

        this.freeBlocks(
            node.size
        );

        const parent =
            node.parent;

        parent.children =
            parent.children.filter(
                (child) =>
                    child !== node
            );

        this.closeDescriptorsForNode(
            node
        );

        this.touchParent(
            parent
        );

        this.log(
            "WARNING",
            `File deleted: ${path}`
        );

        this.syncLegacyFS();

        return {
            success: true
        };
    }


    /* =====================================================
       COPY
       ===================================================== */

    cp(source, destination) {
        const sourceNode =
            this.resolve(source);

        if (
            !sourceNode ||
            !sourceNode.isFile()
        ) {
            return {
                success: false,
                error:
                    "Source file not found."
            };
        }

        let target =
            this.resolve(destination);

        if (
            target &&
            target.isDirectory()
        ) {
            destination =
                destination.replace(
                    /\/$/,
                    ""
                ) +
                "/" +
                sourceNode.name;
        }

        const created =
            this.touch(
                destination
            );

        if (
            !created.success
        ) {
            return created;
        }

        return this.writeFile(
            destination,
            sourceNode.content
        );
    }


    /* =====================================================
       MOVE / RENAME
       ===================================================== */

    mv(source, destination) {
        const sourceNode =
            this.resolve(source);

        if (!sourceNode) {
            return {
                success: false,
                error:
                    "Source not found."
            };
        }

        let destinationNode =
            this.resolve(
                destination
            );

        if (
            destinationNode &&
            destinationNode.isDirectory()
        ) {
            destination =
                destination.replace(
                    /\/$/,
                    ""
                ) +
                "/" +
                sourceNode.name;

            destinationNode =
                this.resolve(
                    destination
                );
        }

        if (destinationNode) {
            return {
                success: false,
                error:
                    "Destination already exists."
            };
        }

        const result =
            this.resolveParent(
                destination
            );

        if (
            !result ||
            !result.parent ||
            !result.parent.isDirectory()
        ) {
            return {
                success: false,
                error:
                    "Destination parent does not exist."
            };
        }

        sourceNode.parent.children =
            sourceNode.parent.children.filter(
                (child) =>
                    child !== sourceNode
            );

        sourceNode.name =
            result.name;

        sourceNode.parent =
            result.parent;

        result.parent.children.push(
            sourceNode
        );

        sourceNode.modifiedAt =
            new Date();

        this.touchParent(
            result.parent
        );

        this.log(
            "INFO",
            `Moved ${source} → ${destination}`
        );

        this.syncLegacyFS();

        return {
            success: true,
            node:
                sourceNode
        };
    }


    /* =====================================================
       DIRECTORY LISTING
       ===================================================== */

    ls(path = ".") {
        const node =
            this.resolve(path);

        if (!node) {
            return {
                success: false,
                error:
                    "Path not found."
            };
        }

        if (
            node.isFile()
        ) {
            return {
                success: true,
                entries: [
                    this.statObject(
                        node
                    )
                ]
            };
        }

        return {
            success: true,
            entries:
                node.children.map(
                    (child) =>
                        this.statObject(
                            child
                        )
                )
        };
    }


    /* =====================================================
       STAT
       ===================================================== */

    stat(path) {
        const node =
            this.resolve(path);

        if (!node) {
            return {
                success: false,
                error:
                    "Path not found."
            };
        }

        return {
            success: true,
            stat:
                this.statObject(
                    node
                )
        };
    }


    statObject(node) {
        this.updateInode(
            node
        );

        return {
            name:
                node.name ||
                "/",

            type:
                node.type,

            path:
                node.getPath(),

            inode:
                node.inode.number,

            size:
                node.size,

            blocks:
                node.inode.blocks,

            permissions:
                node.permissions,

            owner:
                node.owner,

            createdAt:
                node.createdAt,

            modifiedAt:
                node.modifiedAt,

            children:
                node.isDirectory()
                    ? node.children.length
                    : undefined
        };
    }


    /* =====================================================
       CHANGE DIRECTORY
       ===================================================== */

    cd(path = "/") {
        const node =
            this.resolve(path);

        if (
            !node ||
            !node.isDirectory()
        ) {
            return {
                success: false,
                error:
                    "Directory not found."
            };
        }

        this.cwd =
            node;

        return {
            success: true,
            path:
                node.getPath()
        };
    }


    pwd() {
        return this.cwd.getPath();
    }


    /* =====================================================
       OPEN / CLOSE
       ===================================================== */

    open(
        path,
        mode = "r"
    ) {
        const node =
            this.resolve(path);

        if (
            !node ||
            !node.isFile()
        ) {
            return {
                success: false,
                error:
                    "File not found."
            };
        }

        const fd =
            this.nextFd++;

        const descriptor = {
            fd,
            path:
                node.getPath(),
            nodeId:
                node.id,
            mode,
            offset: 0,
            openedAt:
                new Date()
        };

        this.fileDescriptors.set(
            fd,
            descriptor
        );

        this.openFiles.set(
            fd,
            node
        );

        return {
            success: true,
            fd
        };
    }


    close(fd) {
        fd =
            Number(fd);

        if (
            !this.fileDescriptors.has(
                fd
            )
        ) {
            return {
                success: false,
                error:
                    "Invalid file descriptor."
            };
        }

        this.fileDescriptors.delete(
            fd
        );

        this.openFiles.delete(
            fd
        );

        return {
            success: true
        };
    }


    readFd(
        fd,
        length = null
    ) {
        fd =
            Number(fd);

        const descriptor =
            this.fileDescriptors.get(
                fd
            );

        const node =
            this.openFiles.get(
                fd
            );

        if (
            !descriptor ||
            !node
        ) {
            return {
                success: false,
                error:
                    "Invalid file descriptor."
            };
        }

        let content =
            node.content.slice(
                descriptor.offset
            );

        if (
            length !== null
        ) {
            content =
                content.slice(
                    0,
                    Number(length)
                );
        }

        descriptor.offset +=
            content.length;

        return {
            success: true,
            content
        };
    }


    writeFd(
        fd,
        content
    ) {
        fd =
            Number(fd);

        const descriptor =
            this.fileDescriptors.get(
                fd
            );

        const node =
            this.openFiles.get(
                fd
            );

        if (
            !descriptor ||
            !node
        ) {
            return {
                success: false,
                error:
                    "Invalid file descriptor."
            };
        }

        if (
            !descriptor.mode.includes(
                "w"
            ) &&
            !descriptor.mode.includes(
                "a"
            )
        ) {
            return {
                success: false,
                error:
                    "File not opened for writing."
            };
        }

        const text =
            String(
                content ?? ""
            );

        if (
            descriptor.mode.includes(
                "a"
            )
        ) {
            node.content += text;
        } else {
            node.content =
                node.content.slice(
                    0,
                    descriptor.offset
                ) +
                text +
                node.content.slice(
                    descriptor.offset +
                        text.length
                );
        }

        descriptor.offset +=
            text.length;

        node.size =
            node.content.length;

        node.modifiedAt =
            new Date();

        this.updateInode(
            node
        );

        this.syncLegacyFS();

        return {
            success: true,
            bytes:
                text.length
        };
    }


    closeDescriptorsForNode(
        node
    ) {
        for (
            const [
                fd,
                openNode
            ] of this.openFiles
        ) {
            if (
                openNode === node
            ) {
                this.close(fd);
            }
        }
    }


    /* =====================================================
       TREE
       ===================================================== */

    tree(
        path = "/",
        depth = Infinity
    ) {
        const root =
            this.resolve(path);

        if (!root) {
            return "";
        }

        const lines = [];

        const walk =
            (
                node,
                prefix,
                level
            ) => {
                lines.push(
                    prefix +
                    (
                        node === root
                            ? (
                                  node ===
                                  this.root
                                      ? "/"
                                      : node.name
                              )
                            : node.name
                    )
                );

                if (
                    !node.isDirectory() ||
                    level >= depth
                ) {
                    return;
                }

                node.children.forEach(
                    (child, index) => {
                        const last =
                            index ===
                            node.children.length -
                                1;

                        walk(
                            child,
                            prefix +
                                (
                                    node ===
                                    root
                                        ? ""
                                        : "│   "
                                ) +
                                (
                                    last
                                        ? "└── "
                                        : "├── "
                                ),
                            level + 1
                        );
                    }
                );
            };

        walk(
            root,
            "",
            0
        );

        return lines.join(
            "\n"
        );
    }


    /* =====================================================
       FILE SYSTEM STATISTICS
       ===================================================== */

    getStats() {
        let files = 0;
        let directories = 0;
        let bytes = 0;
        let inodes = 0;

        const walk = (
            node
        ) => {
            inodes++;

            if (
                node.isFile()
            ) {
                files++;
                bytes +=
                    node.size;
            } else {
                directories++;

                node.children.forEach(
                    walk
                );
            }
        };

        walk(
            this.root
        );

        return {
            files,
            directories,
            bytes,
            inodes,
            totalBlocks:
                this.totalBlocks,
            usedBlocks:
                this.usedBlocks,
            freeBlocks:
                this.superblock.freeBlocks,
            blockSize:
                this.blockSize,
            diskUsage:
                (
                    this.usedBlocks /
                    this.totalBlocks
                ) *
                100
        };
    }


    /* =====================================================
       PERSISTENCE
       ===================================================== */

    serialize() {
        const serializeNode =
            (node) => ({
                id:
                    node.id,

                name:
                    node.name,

                type:
                    node.type,

                content:
                    node.content,

                size:
                    node.size,

                permissions:
                    node.permissions,

                owner:
                    node.owner,

                createdAt:
                    node.createdAt,

                modifiedAt:
                    node.modifiedAt,

                inode:
                    node.inode
                        ? {
                              ...node.inode
                          }
                        : null,

                children:
                    node.children.map(
                        serializeNode
                    )
            });

        return {
            version: 1,
            blockSize:
                this.blockSize,
            totalBlocks:
                this.totalBlocks,
            usedBlocks:
                this.usedBlocks,
            nextInode:
                this.nextInode,
            root:
                serializeNode(
                    this.root
                )
        };
    }


    save() {
        try {
            localStorage.setItem(
                "os-simx-filesystem",
                JSON.stringify(
                    this.serialize()
                )
            );

            return true;
        } catch (error) {
            this.log(
                "ERROR",
                "Failed to persist filesystem."
            );

            return false;
        }
    }


    load() {
        try {
            const raw =
                localStorage.getItem(
                    "os-simx-filesystem"
                );

            if (!raw) {
                return false;
            }

            const data =
                JSON.parse(raw);

            if (
                !data ||
                !data.root
            ) {
                return false;
            }

            const restore =
                (
                    serialized,
                    parent
                ) => {
                    const node =
                        new FSNode(
                            serialized.name,
                            serialized.type,
                            parent
                        );

                    node.id =
                        serialized.id ||
                        node.id;

                    node.content =
                        serialized.content ||
                        "";

                    node.size =
                        Number(
                            serialized.size
                        ) || 0;

                    node.permissions =
                        serialized.permissions ||
                        "rw-r--r--";

                    node.owner =
                        serialized.owner ||
                        "user";

                    node.createdAt =
                        new Date(
                            serialized.createdAt
                        );

                    node.modifiedAt =
                        new Date(
                            serialized.modifiedAt
                        );

                    node.inode =
                        serialized.inode
                            ? new Inode(
                                  serialized.inode.number,
                                  node
                              )
                            : this.allocateInode(
                                  node
                              );

                    if (
                        serialized.inode
                    ) {
                        Object.assign(
                            node.inode,
                            serialized.inode
                        );
                    }

                    node.children =
                        (
                            serialized.children ||
                            []
                        ).map(
                            (child) =>
                                restore(
                                    child,
                                    node
                                )
                        );

                    return node;
                };

            this.blockSize =
                data.blockSize ||
                512;

            this.totalBlocks =
                data.totalBlocks ||
                2048;

            this.usedBlocks =
                data.usedBlocks ||
                0;

            this.nextInode =
                data.nextInode ||
                1;

            this.root =
                restore(
                    data.root,
                    null
                );

            this.cwd =
                this.root;

            this.superblock.freeBlocks =
                this.totalBlocks -
                this.usedBlocks;

            this.log(
                "INFO",
                "Filesystem restored from persistent storage."
            );

            this.syncLegacyFS();

            return true;
        } catch (error) {
            this.log(
                "ERROR",
                "Filesystem restore failed."
            );

            return false;
        }
    }


    /* =====================================================
       PARENT TIMESTAMP
       ===================================================== */

    touchParent(parent) {
        if (!parent) {
            return;
        }

        parent.modifiedAt =
            new Date();

        this.updateInode(
            parent
        );
    }


    /* =====================================================
       LEGACY OS BRIDGE
       ===================================================== */

    syncLegacyFS() {
        if (!window.OS) {
            return;
        }

        if (
            !window.OS.filesystem
        ) {
            window.OS.filesystem = {};
        }

        window.OS.filesystem.cwd =
            this.pwd();

        window.OS.filesystem.stats =
            this.getStats();

        window.OS.filesystem.tree =
            this.tree();

        window.OS.filesystem.superblock =
            {
                ...this.superblock
            };
    }


    /* =====================================================
       LOGGING
       ===================================================== */

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


/* =========================================================
   GLOBAL FILESYSTEM INSTANCE
   ========================================================= */

window.fileSystem =
    new FileSystem();


/* =========================================================
   TRY LOAD PERSISTED FILESYSTEM
   ========================================================= */

window.fileSystem.load();


/* =========================================================
   FILESYSTEM API
   ========================================================= */

window.FS = {

    mkdir(path) {
        return window.fileSystem.mkdir(
            path
        );
    },

    rmdir(path) {
        return window.fileSystem.rmdir(
            path
        );
    },

    touch(path) {
        return window.fileSystem.touch(
            path
        );
    },

    write(path, content) {
        return window.fileSystem.writeFile(
            path,
            content
        );
    },

    append(path, content) {
        return window.fileSystem.appendFile(
            path,
            content
        );
    },

    read(path) {
        return window.fileSystem.readFile(
            path
        );
    },

    rm(path) {
        return window.fileSystem.rm(
            path
        );
    },

    cp(source, destination) {
        return window.fileSystem.cp(
            source,
            destination
        );
    },

    mv(source, destination) {
        return window.fileSystem.mv(
            source,
            destination
        );
    },

    ls(path = ".") {
        return window.fileSystem.ls(
            path
        );
    },

    cd(path) {
        return window.fileSystem.cd(
            path
        );
    },

    pwd() {
        return window.fileSystem.pwd();
    },

    stat(path) {
        return window.fileSystem.stat(
            path
        );
    },

    open(path, mode = "r") {
        return window.fileSystem.open(
            path,
            mode
        );
    },

    close(fd) {
        return window.fileSystem.close(
            fd
        );
    },

    readFd(fd, length) {
        return window.fileSystem.readFd(
            fd,
            length
        );
    },

    writeFd(fd, content) {
        return window.fileSystem.writeFd(
            fd,
            content
        );
    },

    tree(path = "/") {
        return window.fileSystem.tree(
            path
        );
    },

    stats() {
        return window.fileSystem.getStats();
    },

    save() {
        return window.fileSystem.save();
    },

    load() {
        return window.fileSystem.load();
    }
};


/* =========================================================
   TERMINAL-COMPATIBLE GLOBAL FUNCTIONS
   ========================================================= */

window.fsLs =
    function (path = ".") {
        return window.fileSystem.ls(
            path
        );
    };

window.fsCd =
    function (path = "/") {
        return window.fileSystem.cd(
            path
        );
    };

window.fsPwd =
    function () {
        return window.fileSystem.pwd();
    };

window.fsCat =
    function (path) {
        return window.fileSystem.readFile(
            path
        );
    };

window.fsTouch =
    function (path) {
        return window.fileSystem.touch(
            path
        );
    };

window.fsMkdir =
    function (path) {
        return window.fileSystem.mkdir(
            path
        );
    };

window.fsRm =
    function (path) {
        return window.fileSystem.rm(
            path
        );
    };

window.fsWrite =
    function (
        path,
        content
    ) {
        return window.fileSystem.writeFile(
            path,
            content
        );
    };


/* =========================================================
   AUTOSAVE
   ========================================================= */

setInterval(
    () => {
        if (
            window.fileSystem
        ) {
            window.fileSystem.save();
        }
    },
    10000
);