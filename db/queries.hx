QUERY ClearRepoGraph() =>
    DROP V<FileEmbedding>
    DROP N<File>
    DROP N<Package>
    DROP N<Directory>
    RETURN "ok"

QUERY ClearFileEmbeddings() =>
    DROP V<FileEmbedding>
    RETURN "ok"

QUERY CreateFile(
    file_id: String,
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
    topo_order: I64
) =>
    file <- AddN<File>({
        file_id: file_id,
        extension: extension,
        size_bytes: size_bytes,
        content: content,
        tree_depth: tree_depth,
        is_entry_point: is_entry_point,
        is_leaf_dep: is_leaf_dep,
        is_orphan: is_orphan,
        is_in_cycle: is_in_cycle,
        cycle_id: cycle_id,
        import_count: import_count,
        imported_by_count: imported_by_count,
        dep_depth: dep_depth,
        topo_order: topo_order
    })
    RETURN file

QUERY CreateDirectory(
    dir_id: String,
    tree_depth: I64,
    file_count: I64,
    total_file_count: I64
) =>
    directory <- AddN<Directory>({
        dir_id: dir_id,
        tree_depth: tree_depth,
        file_count: file_count,
        total_file_count: total_file_count
    })
    RETURN directory

QUERY CreatePackage(package_id: String, imported_by_count: I64) =>
    package <- AddN<Package>({
        package_id: package_id,
        imported_by_count: imported_by_count
    })
    RETURN package

QUERY CreateContainsDirectory(parent_dir_id: String, child_dir_id: String) =>
    parent <- N<Directory>({dir_id: parent_dir_id})
    child <- N<Directory>({dir_id: child_dir_id})
    edge <- AddE<ContainsDirectory>::From(parent)::To(child)
    RETURN edge

QUERY CreateContainsFile(dir_id: String, file_id: String) =>
    directory <- N<Directory>({dir_id: dir_id})
    file <- N<File>({file_id: file_id})
    edge <- AddE<ContainsFile>::From(directory)::To(file)
    RETURN edge

QUERY CreateImport(from_file_id: String, to_file_id: String, specifier: String, names: String) =>
    from_file <- N<File>({file_id: from_file_id})
    to_file <- N<File>({file_id: to_file_id})
    edge <- AddE<Imports>({
        specifier: specifier,
        names: names
    })::From(from_file)::To(to_file)
    RETURN edge

QUERY CreateImportExternal(file_id: String, package_id: String, specifier: String, names: String) =>
    file <- N<File>({file_id: file_id})
    package <- N<Package>({package_id: package_id})
    edge <- AddE<ImportsExternal>({
        specifier: specifier,
        names: names
    })::From(file)::To(package)
    RETURN edge

QUERY GetIndexCounts() =>
    files <- N<File>::COUNT
    directories <- N<Directory>::COUNT
    packages <- N<Package>::COUNT
    contains_directories <- E<ContainsDirectory>::COUNT
    contains_files <- E<ContainsFile>::COUNT
    imports <- E<Imports>::COUNT
    imports_external <- E<ImportsExternal>::COUNT
    embeddings <- V<FileEmbedding>::COUNT
    RETURN {
        files: files,
        directories: directories,
        packages: packages,
        contains_directories: contains_directories,
        contains_files: contains_files,
        imports: imports,
        imports_external: imports_external,
        embeddings: embeddings
    }

QUERY CreateFileEmbedding(file_id: String, vector: [F64]) =>
    vector_node <- AddV<FileEmbedding>(vector, {
        file_id: file_id,
        model: "universal-sentence-encoder-512"
    })
    RETURN vector_node

QUERY SearchFileEmbeddings(query_vector: [F64], limit: I64) =>
    results <- SearchV<FileEmbedding>(query_vector, limit)
    RETURN results

QUERY ListFiles() =>
    files <- N<File>::ORDER<Asc>(_::{file_id})
    RETURN files

QUERY ListDirectories() =>
    directories <- N<Directory>::ORDER<Asc>(_::{dir_id})
    RETURN directories

QUERY ListPackages() =>
    packages <- N<Package>::ORDER<Asc>(_::{package_id})
    RETURN packages

QUERY ListDirectoryContents(dir_id: String) =>
    directory <- N<Directory>({dir_id: dir_id})::FIRST
    directories <- directory::Out<ContainsDirectory>
    files <- directory::Out<ContainsFile>
    RETURN {
        directories: directories,
        files: files
    }

QUERY GetParentDirectory(file_id: String) =>
    parent <- N<File>({file_id: file_id})::In<ContainsFile>::FIRST
    RETURN parent

QUERY GetFileByPath(file_id: String) =>
    file <- N<File>({file_id: file_id})::FIRST
    RETURN file

QUERY GetFileImports(file_id: String) =>
    edges <- N<File>({file_id: file_id})::OutE<Imports>
    RETURN edges::{
        specifier,
        names,
        to_file_id: _::ToN::{file_id}::FIRST
    }

QUERY GetFileImportedBy(file_id: String) =>
    edges <- N<File>({file_id: file_id})::InE<Imports>
    RETURN edges::{
        specifier,
        names,
        from_file_id: _::FromN::{file_id}::FIRST
    }

QUERY GetPackageImportedBy(package_id: String) =>
    edges <- N<Package>({package_id: package_id})::InE<ImportsExternal>
    RETURN edges::{
        specifier,
        names,
        from_file_id: _::FromN::{file_id}::FIRST
    }

QUERY SearchFileContent(query: String, limit: I64) =>
    results <- SearchBM25<File>(query, limit)
    RETURN results

QUERY SearchFileContentScoped(query: String, file_ids: [String]) =>
    results <- SearchBM25<File>(query, 1000)
    scoped <- results::WHERE(_::{file_id}::IS_IN(file_ids))
    RETURN scoped

QUERY GetFilesByExtension(extension: String) =>
    files <- N<File>::WHERE(_::{extension}::EQ(extension))::ORDER<Asc>(_::{file_id})
    RETURN files

QUERY ListEntryPoints() =>
    files <- N<File>::WHERE(_::{is_entry_point}::EQ(true))::ORDER<Asc>(_::{file_id})
    RETURN files

QUERY ListLeafDependencies() =>
    files <- N<File>::WHERE(_::{is_leaf_dep}::EQ(true))::ORDER<Asc>(_::{file_id})
    RETURN files

QUERY ListOrphans() =>
    files <- N<File>::WHERE(_::{is_orphan}::EQ(true))::ORDER<Asc>(_::{file_id})
    RETURN files

QUERY ListCycles() =>
    files <- N<File>::WHERE(_::{cycle_id}::NEQ(""))::ORDER<Asc>(_::{cycle_id})
    RETURN files

QUERY GetFilesInCycle(cycle_id: String) =>
    files <- N<File>::WHERE(AND(
        _::{cycle_id}::NEQ(""),
        _::{cycle_id}::EQ(cycle_id)
    ))::ORDER<Asc>(_::{file_id})
    RETURN files

QUERY ListMostImported(limit: I64) =>
    files <- N<File>::ORDER<Desc>(_::{imported_by_count})::RANGE(0, limit)
    RETURN files

QUERY GetTopologicalOrder() =>
    files <- N<File>::WHERE(_::{topo_order}::GTE(0))::ORDER<Asc>(_::{topo_order})
    RETURN files
