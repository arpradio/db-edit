const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

async function bulkDeleteEntities(client, ids, tableName, relationTable, relationColumn) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw new Error('Invalid or empty IDs array');
    }

    const checkResult = await client.query(
        `SELECT ${relationColumn} FROM ${relationTable} WHERE ${relationColumn} = ANY($1) LIMIT 1`,
        [ids]
    );

    if (checkResult.rows.length > 0) {
        throw new Error(`Cannot delete ${tableName} with associated songs`);
    }

    const namesResult = await client.query(
        `SELECT name FROM ${tableName} WHERE id = ANY($1)`,
        [ids]
    );

    const deleteResult = await client.query(
        `DELETE FROM ${tableName} WHERE id = ANY($1)`,
        [ids]
    );

    return {
        deletedCount: deleteResult.rowCount,
        deletedNames: namesResult.rows.map(row => row.name)
    };
}

async function deleteSingleEntity(pool, entityId, tableName, relationTable, relationColumn) {
    const checkResult = await pool.query(
        `SELECT count(*) FROM ${relationTable} WHERE ${relationColumn} = $1`,
        [entityId]
    );

    if (parseInt(checkResult.rows[0].count) > 0) {
        throw new Error(`Cannot delete ${tableName.split('.')[1]} with associated songs`);
    }

    const result = await pool.query(
        `DELETE FROM ${tableName} WHERE id = $1 RETURNING name`,
        [entityId]
    );

    if (result.rows.length === 0) {
        throw new Error(`${tableName.split('.')[1]} not found`);
    }

    return result.rows[0].name;
}

module.exports = { asyncHandler, bulkDeleteEntities, deleteSingleEntity };
