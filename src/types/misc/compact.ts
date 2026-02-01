export type CompactSummaryMode = "conversation" | "roleplay";

export interface CompactRoleplayCharacter {
	name: string;
	current_goals: string;
	emotional_status: string;
	physical_status: string;
	appearance_clothing: string;
	inventory: string;
}

export interface CompactRoleplaySummary {
	overall_scene_summary: string;
	characters: CompactRoleplayCharacter[];
}
