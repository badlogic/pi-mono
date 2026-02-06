import { describe, expect, it } from "vitest";
import { type CustomMessageEntry, SessionManager } from "../../src/core/session-manager.js";
import { assistantMsg, userMsg } from "../utilities.js";

describe("SessionManager.replaceEntries", () => {
	describe("basic replacement", () => {
		it("replaces middle entries with a cognition fragment", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			const id3 = session.appendMessage(userMsg("msg3"));
			const id4 = session.appendMessage(assistantMsg("msg4"));
			const id5 = session.appendMessage(userMsg("msg5"));

			// Replace msg2, msg3, msg4 with a cognition fragment
			const newId = session.replaceEntries([id2, id3, id4], {
				customType: "cognition-fragment",
				content: "[discovery] something learned",
				display: true,
				details: { archiveId: "arc_001" },
			});

			const entries = session.getEntries();
			expect(entries).toHaveLength(3); // id1, newId, id5

			expect(entries[0].id).toBe(id1);
			expect(entries[1].id).toBe(newId);
			expect(entries[2].id).toBe(id5);
		});

		it("preserves parentId chain after replacement", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			const id3 = session.appendMessage(userMsg("msg3"));
			const id4 = session.appendMessage(assistantMsg("msg4"));
			session.appendMessage(userMsg("msg5"));

			const newId = session.replaceEntries([id2, id3, id4], {
				customType: "cognition-fragment",
				content: "cognition",
				display: true,
			});

			const entries = session.getEntries();
			// id1 -> newEntry -> id5
			expect(entries[0].parentId).toBeNull(); // id1 is root
			expect(entries[1].parentId).toBe(id1); // newEntry's parent = first deleted's parent (id1)
			expect(entries[2].parentId).toBe(newId); // id5 re-linked to newEntry
		});

		it("creates correct custom_message entry type", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));

			const newId = session.replaceEntries([id1, id2], {
				customType: "cognition-fragment",
				content: "<cognition>test</cognition>",
				display: true,
				details: { archiveId: "arc_001", tokensBefore: 5000, tokensAfter: 100 },
			});

			const entry = session.getEntry(newId) as CustomMessageEntry;
			expect(entry).toBeDefined();
			expect(entry.type).toBe("custom_message");
			expect(entry.customType).toBe("cognition-fragment");
			expect(entry.content).toBe("<cognition>test</cognition>");
			expect(entry.display).toBe(true);
			expect(entry.details).toEqual({
				archiveId: "arc_001",
				tokensBefore: 5000,
				tokensAfter: 100,
			});
		});
	});

	describe("leafId management", () => {
		it("updates leafId when leaf is in deleted set", () => {
			const session = SessionManager.inMemory();

			session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			const id3 = session.appendMessage(userMsg("msg3"));

			expect(session.getLeafId()).toBe(id3);

			const newId = session.replaceEntries([id2, id3], {
				customType: "cognition-fragment",
				content: "cognition",
				display: true,
			});

			expect(session.getLeafId()).toBe(newId);
		});

		it("preserves leafId when leaf is not in deleted set", () => {
			const session = SessionManager.inMemory();

			session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			session.appendMessage(userMsg("msg3"));
			const id4 = session.appendMessage(assistantMsg("msg4"));

			expect(session.getLeafId()).toBe(id4);

			session.replaceEntries([id2], {
				customType: "cognition-fragment",
				content: "cognition",
				display: true,
			});

			expect(session.getLeafId()).toBe(id4);
		});
	});

	describe("replacing first entry", () => {
		it("handles replacement of the very first entry", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			const id3 = session.appendMessage(userMsg("msg3"));

			const newId = session.replaceEntries([id1], {
				customType: "cognition-fragment",
				content: "cognition of msg1",
				display: true,
			});

			const entries = session.getEntries();
			expect(entries).toHaveLength(3);
			expect(entries[0].id).toBe(newId);
			expect(entries[0].parentId).toBeNull(); // root
			expect(entries[1].id).toBe(id2);
			expect(entries[1].parentId).toBe(newId); // re-linked
			expect(entries[2].id).toBe(id3);
			expect(entries[2].parentId).toBe(id2); // unchanged
		});
	});

	describe("replacing all entries", () => {
		it("replaces all entries in session", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));

			const newId = session.replaceEntries([id1, id2], {
				customType: "cognition-fragment",
				content: "full session cognition",
				display: true,
			});

			const entries = session.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].id).toBe(newId);
			expect(entries[0].parentId).toBeNull();
			expect(session.getLeafId()).toBe(newId);
		});
	});

	describe("getBranch after replacement", () => {
		it("getBranch traverses correctly through replacement", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			const id3 = session.appendMessage(userMsg("msg3"));
			const id4 = session.appendMessage(assistantMsg("msg4"));
			const id5 = session.appendMessage(userMsg("msg5"));

			const newId = session.replaceEntries([id2, id3, id4], {
				customType: "cognition-fragment",
				content: "cognition",
				display: true,
			});

			const branch = session.getBranch();
			expect(branch).toHaveLength(3);
			expect(branch.map((e) => e.id)).toEqual([id1, newId, id5]);
		});
	});

	describe("buildSessionContext after replacement", () => {
		it("includes cognition fragment in LLM context", () => {
			const session = SessionManager.inMemory();

			session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			const id3 = session.appendMessage(userMsg("msg3"));
			session.appendMessage(assistantMsg("msg4"));

			session.replaceEntries([id2, id3], {
				customType: "cognition-fragment",
				content: "[discovery] key finding",
				display: true,
			});

			const ctx = session.buildSessionContext();
			// msg1 (user) + cognition (custom_message → user) + msg4 (assistant)
			expect(ctx.messages).toHaveLength(3);

			// The cognition fragment should be in context as a custom message
			const cognitionMsg = ctx.messages[1];
			expect(cognitionMsg.role).toBe("custom");
		});
	});

	describe("repeated replacement (二次降温)", () => {
		it("can replace a previous cognition fragment with a new one", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			const id3 = session.appendMessage(userMsg("msg3"));
			const id4 = session.appendMessage(assistantMsg("msg4"));
			const id5 = session.appendMessage(userMsg("msg5"));

			// First cooling: replace msg2, msg3 with cognition A
			const cogA = session.replaceEntries([id2, id3], {
				customType: "cognition-fragment",
				content: "cognition A",
				display: true,
			});

			let entries = session.getEntries();
			expect(entries).toHaveLength(4); // id1, cogA, id4, id5

			// Second cooling: replace cognition A and msg4 with cognition B
			const cogB = session.replaceEntries([cogA, id4], {
				customType: "cognition-fragment",
				content: "cognition B (higher level)",
				display: true,
			});

			entries = session.getEntries();
			// id5's parent was id4, which was deleted → re-linked to cogB
			expect(entries).toHaveLength(3); // id1, cogB, id5
			expect(entries[0].id).toBe(id1);
			expect(entries[1].id).toBe(cogB);
			expect(entries[2].id).toBe(id5);

			// Chain: id1 → cogB → id5
			expect(entries[1].parentId).toBe(id1);
			expect(entries[2].parentId).toBe(cogB);
		});
	});

	describe("error handling", () => {
		it("throws on empty deleteIds", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("msg1"));

			expect(() =>
				session.replaceEntries([], {
					customType: "test",
					content: "test",
					display: true,
				}),
			).toThrow("deleteIds must not be empty");
		});

		it("throws when trying to delete compaction entries", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			session.appendMessage(assistantMsg("msg2"));
			const compId = session.appendCompaction("summary", id1, 1000);

			expect(() =>
				session.replaceEntries([compId], {
					customType: "test",
					content: "test",
					display: true,
				}),
			).toThrow("cannot delete compaction");
		});

		it("throws when deleteIds not found", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("msg1"));

			expect(() =>
				session.replaceEntries(["nonexistent"], {
					customType: "test",
					content: "test",
					display: true,
				}),
			).toThrow("none of the deleteIds found");
		});
	});

	describe("byId consistency", () => {
		it("deleted entries are not findable via getEntry", () => {
			const session = SessionManager.inMemory();

			session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));
			session.appendMessage(userMsg("msg3"));

			session.replaceEntries([id2], {
				customType: "cognition-fragment",
				content: "cognition",
				display: true,
			});

			expect(session.getEntry(id2)).toBeUndefined();
		});

		it("new entry is findable via getEntry", () => {
			const session = SessionManager.inMemory();

			session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("msg2"));

			const newId = session.replaceEntries([id2], {
				customType: "cognition-fragment",
				content: "cognition",
				display: true,
			});

			const entry = session.getEntry(newId);
			expect(entry).toBeDefined();
			expect(entry?.type).toBe("custom_message");
		});
	});

	describe("single entry replacement", () => {
		it("replaces single entry correctly", () => {
			const session = SessionManager.inMemory();

			const id1 = session.appendMessage(userMsg("msg1"));
			const id2 = session.appendMessage(assistantMsg("long tool output..."));
			const id3 = session.appendMessage(userMsg("msg3"));

			const newId = session.replaceEntries([id2], {
				customType: "cognition-fragment",
				content: "[discovery] tool output summary",
				display: true,
			});

			const entries = session.getEntries();
			expect(entries).toHaveLength(3);
			expect(entries[0].id).toBe(id1);
			expect(entries[1].id).toBe(newId);
			expect(entries[2].id).toBe(id3);

			// Chain integrity
			expect(entries[1].parentId).toBe(id1);
			expect(entries[2].parentId).toBe(newId);
		});
	});
});
