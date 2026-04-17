from pathlib import Path
from src.services.extractor import extract_all, convert_doc_to_docx
files = [
 r"C:\Users\T7I\Documents\LRDU\BRD\latest brd\Deutscher+Bundestag+(German+Parliament)+(DE.PAR)+Acts (4).doc",
 r"C:\Users\T7I\Documents\LRDU\BRD\latest brd\Deutscher+Bundestag+(German+Parliament)+(DE.PAR)+Acts+(Evergreen+Ingestion+v2.0).docx",
 r"C:\Users\T7I\Documents\LRDU\BRD\latest brd\China+Securities+Depository+and+Clearing+Corporation+Limited+(CN.CSDC)+Rules.docx",
 r"C:\Users\T7I\Documents\LRDU\BRD\latest brd\Swiss+Federal+Council+(CH.Council)+Ordinances+(Evergreen+Ingestion+v2.0) (1).doc",
]
for path in files:
    actual = path
    temp = None
    try:
        if path.lower().endswith('.doc'):
            temp = convert_doc_to_docx(path)
            actual = temp or path
        data = extract_all(actual)
        toc = data.get('toc', {})
        citations = data.get('citations', {})
        scope = data.get('scope', {})
        print('\n===', Path(path).name, '===')
        print('tocSortingOrder ->', repr(str(toc.get('tocSortingOrder',''))[:220]))
        print('citationLevelSmeCheckpoint ->', repr(str(citations.get('citationLevelSmeCheckpoint',''))[:220]))
        print('citationRulesSmeCheckpoint ->', repr(str(citations.get('citationRulesSmeCheckpoint',''))[:220]))
        print('scopeSmeCheckpoint ->', repr(str(scope.get('smeCheckpoint',''))[:220]))
    except Exception as e:
        print('\n===', Path(path).name, '===')
        print('ERROR ->', e)
