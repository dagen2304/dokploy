import { dbUrl } from "@dokploy/server/db";
import { runOlympeBootstrap } from "@dokploy/server/db/olympe-bootstrap";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const sql = postgres(dbUrl, { max: 1 });
const db = drizzle(sql);

try {
	await migrate(db, { migrationsFolder: "drizzle" });
	console.log("Migration complete");
	await runOlympeBootstrap(sql);
	console.log("Olympe tables ready");
} catch (error) {
	console.log("Migration failed", error);
} finally {
	await sql.end();
}
