from src.services.extractor import extract_all
from pathlib import Path
files = [
 r"C:\Users\T7I\Documents\LRDU\BRD\latest brd\Deutscher+Bundestag+(German+Parliament)+(DE.PAR)+Acts (4).doc",
 r"C:\Users\T7I\Documents\LRDU\BRD\latest brd\Deutscher+Bundestag+(German+Parliament)+(DE.PAR)+Acts+(Evergreen+Ingestion+v2.0).docx",
 r"C:\Users\T7I\Documents\LRDU\BRD\latest brd\China+Securities+Depository+and+Clearing+Corporation+Limited+(CN.CSDC)+Rules.docx",
 r"C:\Users\T7I\Documents\LRDU\BRD\latest brd\Swiss+Federal+Council+(CH.Council)+Ordinances+(Evergreen+Ingestion+v2.0) (1).doc",
]
for path in files:
    print('\n===', Path(path).name, '===')
    try:
        data = extract_all(path)
        toc = data.get('toc', {})
        citations = data.get('citations', {})
        scope = data.get('scope', {})
        print('tocSortingOrder:', repr(str(toc.get('tocSortingOrder',''))[:500]))
        print('citationLevelSmeCheckpoint:', repr(str(citations.get('citationLevelSmeCheckpoint',''))[:500]))
        print('citationRulesSmeCheckpoint:', repr(str(citations.get('citationRulesSmeCheckpoint',''))[:500]))
        print('scopeSmeCheckpoint:', repr(str(scope.get('smeCheckpoint',''))[:500]))
    except Exception as e:
        print('ERROR:', e)
