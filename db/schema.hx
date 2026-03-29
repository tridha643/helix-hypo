N::File {
    UNIQUE INDEX file_id: String,
    extension: String,
    size_bytes: I64,
    content: String,
    tree_depth: I64,
    is_entry_point: Boolean,
    is_leaf_dep: Boolean,
    is_orphan: Boolean,
    is_in_cycle: Boolean,
    cycle_id: String,
    import_count: I64,
    imported_by_count: I64,
    dep_depth: I64,
    topo_order: I64,
}

N::Directory {
    UNIQUE INDEX dir_id: String,
    tree_depth: I64,
    file_count: I64,
    total_file_count: I64,
}

N::Package {
    UNIQUE INDEX package_id: String,
    imported_by_count: I64,
}

// HelixQL edge definitions require a single target node type, so the
// structural "contains" relationship is represented with two edge labels.
E::ContainsDirectory {
    From: Directory,
    To: Directory,
}

E::ContainsFile {
    From: Directory,
    To: File,
}

E::Imports {
    From: File,
    To: File,
    Properties: {
        specifier: String,
        names: String,
    }
}

E::ImportsExternal {
    From: File,
    To: Package,
    Properties: {
        specifier: String,
        names: String,
    }
}
