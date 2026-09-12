import unittest
from unittest.mock import AsyncMock, patch

import main
from ollama_client import OllamaProcessingError, generate_skill, parse_reasoning
from schemas import (
    AgentSkill,
    ParsedReasoning,
    ReasoningParseRequest,
    ReasoningSnippet,
    SkillGenerateRequest,
    SkillSource,
    BenchmarkRequest,
)


class OllamaClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_parse_preserves_indices_and_normalizes_ids(self):
        parsed = ParsedReasoning(
            summary="Compared two options.",
            snippets=[
                ReasoningSnippet(
                    id="]]reasoning_snippet_1",
                    title="Inspect first option",
                    summary="Inspected the first available option.",
                    kind="comparison",
                    source_indices=[4],
                ),
                ReasoningSnippet(
                    id="]]reasoning_snippet_1",
                    title="Inspect second option",
                    summary="Inspected the second available option.",
                    kind="comparison",
                    source_indices=[9],
                ),
            ],
        )
        request = ReasoningParseRequest(
            model="example/model",
            case_id="case-1",
            reasoning_details=[{"index": 4}, {"index": 9}],
        )

        with patch("ollama_client._structured_chat", new=AsyncMock(return_value=parsed)):
            result = await parse_reasoning(request)

        self.assertEqual(
            [snippet.id for snippet in result.snippets],
            ["snippet-0", "snippet-1"],
        )
        self.assertEqual(
            [snippet.source_indices for snippet in result.snippets],
            [[4], [9]],
        )
        self.assertEqual(request.reasoning_details, [{"index": 4}, {"index": 9}])

    async def test_parse_rejects_unknown_source_index(self):
        parsed = ParsedReasoning(
            summary="Unsupported source.",
            snippets=[
                ReasoningSnippet(
                    id="snippet-0",
                    title="Bad source",
                    summary="References an unknown source.",
                    kind="other",
                    source_indices=[99],
                )
            ],
        )
        request = ReasoningParseRequest(
            model="example/model",
            case_id="case-1",
            reasoning_details=[{"index": 0}],
        )

        with patch("ollama_client._structured_chat", new=AsyncMock(return_value=parsed)):
            with self.assertRaises(OllamaProcessingError):
                await parse_reasoning(request)

    async def test_skill_requires_exact_selected_ids(self):
        snippet = ReasoningSnippet(
            id="snippet-1",
            title="Validate",
            summary="Validate the result.",
            kind="validation",
            source_indices=[1],
        )
        request = SkillGenerateRequest(
            source=SkillSource(model="example/model", case_id="case-1"),
            selected_snippets=[snippet],
        )
        skill = AgentSkill(
            name="Validation",
            description="Validate results.",
            when_to_use=["Before responding."],
            procedure=["Check the result."],
            checks=["The result is supported."],
            avoid=["Unsupported claims."],
            source_snippet_ids=["wrong-id"],
        )

        with patch("ollama_client._structured_chat", new=AsyncMock(return_value=skill)):
            with self.assertRaises(OllamaProcessingError):
                await generate_skill(request)


class ApiIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_benchmark_does_not_call_ollama(self):
        async def events(_payload):
            yield {"type": "done", "total_runs": 0}

        with (
            patch.object(main, "benchmark_stream", new=events),
            patch.object(main, "parse_reasoning", new=AsyncMock()) as ollama_parse,
            patch.object(main, "generate_skill", new=AsyncMock()) as ollama_skill,
        ):
            response = await main.benchmark(
                BenchmarkRequest(models=["example/model"], cases=[]),
            )
            body = "".join([chunk async for chunk in response.body_iterator])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body, '{"type": "done", "total_runs": 0}\n')
        ollama_parse.assert_not_awaited()
        ollama_skill.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
