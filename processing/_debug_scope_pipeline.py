import sys
sys.path.insert(0, r"c:\Users\T7I\Documents\GitHub\structo-Web-based-tool\processing")
from src.services.extractor import extract_all, convert_doc_to_docx
path = r"c:\Users\T7I\Documents\LRDU\BRD\Shanghai+Clearing+House+(CN.SCH)+Rules.doc"
converted = convert_doc_to_docx(path)
print("CONVERTED", converted)
result = extract_all(converted)
scope = result.get("scope") or {}
print("COUNTS", len(scope.get("in_scope", [])), len(scope.get("out_of_scope", [])))
for idx, row in enumerate(scope.get("in_scope", [])[:3], start=1):
    print("ROW", idx)
    print("TITLE", (row.get("document_title") or "")[:120])
    print("SME", (row.get("sme_comments") or "")[:500].encode("ascii", "backslashreplace").decode("ascii"))
    print("KEYS", sorted(k for k,v in row.items() if v))
