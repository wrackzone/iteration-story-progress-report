// <script type="text/javascript" src="https://rally1.rallydev.com/apps/2.0rc1/sdk-debug.js"></script>
// <script type="text/javascript" src="https://rally1.rallydev.com/apps/2.0rc1/lib/analytics/analytics-all.js"></script>



Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items: [ { xtype : 'container', layout : { type : 'table',columns : 2 },items : [
            { xtype : 'container', itemId: 'iterationDropDown', columnWidth: 2 },
            { xtype : 'rallycheckboxfield', itemId : 'flatCheckBox', fieldLabel : 'Show only "Flat"', columnWidth : 1,value : false }
        ] },
        { xtype: 'container', itemId: 'chart1', columnWidth: 1 }    
    ],
    
    addIterationDropDown : function() {
        
        var timeboxScope = this.getContext().getTimeboxScope();
        if(timeboxScope) {
            var record = timeboxScope.getRecord();
            var name = record.get('Name');
            
            this.gIteration = record.data;
            this._onIterationSelect();
        } else {
            // add the iteration dropdown selector
            this.down("#iterationDropDown").add( {
                xtype: 'rallyiterationcombobox',
                itemId : 'iterationSelector',
                listeners: {
                        select: this._onIterationSelect,
                        ready:  this._onIterationSelect,
                        scope: this
                }
            });
        }
        
    },
    
    _onIterationSelect : function() {

        if (_.isUndefined( this.getContext().getTimeboxScope())) {
            var value =  this.down('#iterationSelector').getRecord();
            this.gIteration = value.data;
        } 
        
        var iterationId = this.gIteration.ObjectID;
        
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            limit: Infinity,
            listeners: {
                load: this._onIterationSnapShotData,
                scope : this
            },
            fetch: ['ObjectID','Name', 'Priority','ScheduleState', 'PlanEstimate','TaskEstimateTotal','TaskRemainingTotal', '_UnformattedID','Blocked','_Type','_TypeHierarchy' ],
            hydrate: ['ScheduleState','_TypeHierarchy'],
            filters: [
                {
                    property: '_TypeHierarchy',
                    operator: 'in',
                    value: ['Defect','HierarchicalRequirement']
                },
                {
                    property: 'Iteration',
                    operator: 'in',
                    value: iterationId
                }
            ]
        });        
        
        
    },
    
    _getFormattedID : function (item) {
        var type = _.last(item["_TypeHierarchy"]);
        var prefix = _.find( this.types, function (t) { 
            var tname = t.get("Name").replace(/\s+/g, ''); // remove the space
            return tname == type;
        });
        return prefix.get("IDPrefix") + item["_UnformattedID"];
    },
    
    _onIterationSnapShotData : function(store,data,success) {
        
        var that = this;
        var lumenize = window.parent.Rally.data.lookback.Lumenize;
        var snapShotData = _.map(data,function(d){return d.data});      
        var metrics = [];
        var metricsAfterSummary = [];
        var hcConfig = [ { name : "label" }];
        _.each(
            _.uniq(snapShotData, function (e) { return that._getFormattedID(e);}), 
            function (item) {
                var id = item["_UnformattedID"];
                var fid = that._getFormattedID(item);

                var metric1 = {
                    as : fid+"Remaining",
                    f : 'filteredSum',
                    field : 'TaskRemainingTotal',
                    filterField : '_UnformattedID',
                    filterValues : [id]
                };
                var metric2 = {
                    as : fid+"Total",
                    f : 'filteredSum',
                    field : 'TaskEstimateTotal',
                    filterField : '_UnformattedID',
                    filterValues : [id]
                }
                var summary =
                {
                    as: fid, 
                    f: function (row, index, summaryMetrics, seriesData) {
                        var t = row[fid+"Total"];
                        var r = row[fid+"Remaining"];
                        return t > 0 ? ((t-r)/t)*100 : 0;                
                    }
                }
                metricsAfterSummary.push(summary);
                
                metrics.push(metric1);
                metrics.push(metric2);
                
                var hc = {
                    name : fid, comment : item["Name"]
                };
                
                if (item["Blocked"]==true) 
                    hc.dashStyle = "ShortDot";
    
                hcConfig.push( hc );

            }
        );
        
        var config = {
          deriveFieldsOnInput: [],
          metrics: metrics,
          summaryMetricsConfig: [],
          deriveFieldsAfterSummary: metricsAfterSummary,
          granularity: lumenize.Time.DAY,
          tz: 'America/New_York',
          holidays: [],
          workDays: 'Monday,Tuesday,Wednesday,Thursday,Friday'
        };
    
        // release start and end dates
        var startOnISOString = new lumenize.Time(this.gIteration.StartDate).getISOStringInTZ(config.tz)
        var upToDateISOString = new lumenize.Time(this.gIteration.EndDate).getISOStringInTZ(config.tz)

        calculator = new lumenize.TimeSeriesCalculator(config);
        calculator.addSnapshots(snapShotData, startOnISOString, upToDateISOString);

        var hc = lumenize.arrayOfMaps_To_HighChartsSeries(calculator.getResults().seriesData, hcConfig);
        this.ghc = hc;
        this._showChart(hc);
    },

    // return 'flat' if the % complete has been static for > 2 days, but not if it's zero or 100 (complete).    
    isFlat : function(series,todayIndex) {
        var flat = false;
        if (todayIndex != -1 && todayIndex >= 2 ) {
            if (series.data[todayIndex] != 0 && series.data[todayIndex] != 100 )
                if (series.data[todayIndex] == series.data[todayIndex-1] && series.data[todayIndex] == series.data[todayIndex-2])
                    flat = true;
        }
        return flat;
    },
    
    _showChart : function() {
        var that = this;
        var series = this.ghc;
        var chart = this.down("#chart1");
        chart.removeAll();
        // get checkbox value
        var flat = (this.down("#flatCheckBox").getValue());
        
        // remove nulls from chart
        series[1].data = _.map(series[1].data, function(d) { return _.isNull(d) ? 0 : d; });
        
        // find index into series for today
        var today = new Date();         
        var todayIndex = -1;
        _.each( series[0].data, function(x,i) {
            var dt = new Date(Date.parse(x));
            
            if (todayIndex == -1 && dt > today)
                todayIndex = i;
        });

        // set values for future dates to null
        _.each ( series, function(s,i) {
            if (i>0) {
                s.data = _.map(s.data,function(d,x) {
                    
                    return ((todayIndex > 0 && x > todayIndex) ? null :  d);
                });
            }
        });
        
        var newSeries = [];
        if (flat) {
            newSeries = _.filter( series.slice(1,series.length), function(s) { return (that.isFlat(s,todayIndex));} );
        } else {
            newSeries = series.slice(1,series.length);
        }
        
        var extChart = Ext.create('Rally.ui.chart.Chart', {
         chartData: {
            categories : series[0].data,
            series : newSeries
         },
          chartConfig : {
              
                chart: {
                    
                },
                title: {
                text: '',
                x: -20 //center
                },                        
                tooltip: {
                    formatter: function() {
                        
                        return this.series.name + ':' + this.series.options.comment + '<br> The value for <b>'+ this.x +
                    '</b> is <b>'+ Math.round(this.y) +'</b>';
                    }
                },
                legend: {
                            align: 'center',
                            verticalAlign: 'bottom'
                },
                plotOptions : {
                    
                 line : {
                    zIndex : 1,
                    tooltip : {
                        valueSuffix : ' Percent'
                    }

                 }
                },
                 yAxis: {
                    min : 0,
                    max : 100,
                    title: {
                        text: '% Complete by Task Hours'
                    },
                    plotLines: [{
                        value: 0,
                        width: 1,
                        color: '#808080'
                    }]
                },
            }
        });
        chart.add(extChart);
        var p = Ext.get(chart.id);
        var elems = p.query("div.x-mask");
        _.each(elems, function(e) { e.remove(); });
        var elems = p.query("div.x-mask-msg");
        _.each(elems, function(e) { e.remove(); });
    },
    
    getTypePrefixes : function() {
        
        var filter = Ext.create('Rally.data.QueryFilter', {
            property: 'Name',
            operator: '=',
            value: 'Defect'
        });

        var andedTogetherFilter = filter.or(Ext.create('Rally.data.QueryFilter', {
            property: 'Name',
            operator: '=',
            value: 'Hierarchical Requirement'
        }));
        
        var typeStore = Ext.create('Rally.data.WsapiDataStore', {
            autoLoad: true,
            model: 'TypeDefinition',
            fetch: ['Name', 'IDPrefix' ],
            filters: [
                andedTogetherFilter
            ],
            listeners: {
                load: function(store, recs ) {
                    this.types = recs;
                },
                scope : this
            }
        });
    },

    launch : function() {
        
        var that = this;
        this.addIterationDropDown();
        this.getTypePrefixes();
        this.down("#flatCheckBox").on("change",function(){that._showChart();});

    }
});
